const width = 800;
const height = 600;

const canvas = d3.select("#chart")
    .append("canvas")
    .attr("width", width)
    .attr("height", height)
    .style("width", `${width}px`)
    .style("height", `${height}px`)
    .style("display", "block")
    .style("cursor", "grab")
    .node();
const ctx = canvas.getContext("2d");

let nichePreference = 0.5;
let pendingNichePreference = nichePreference;
let nicheAnimationFrame = null;
let heatmapAnimationFrame = null;
let currentListView = "blended";

let favoriteMovieIds = new Set();
let renderedPoints = [];
let selectedMovieId = null;
let currentAnchorPoints = [];

let cfRecommendations = [];
let mfRecommendations = [];
let overlapRecommendations = [];
let blendedRecommendations = [];
let baselineRecommendations = [];
let recommendationScoreById = new Map();

let availableTitleRows = [];
let transformState = { scale: 1, tx: 0, ty: 0 };
let panState = { active: false, moved: false, startX: 0, startY: 0, tx: 0, ty: 0 };

function preferenceLabel(value) {
    if (value < 0.2) return "Mainstream";
    if (value < 0.4) return "Popular";
    if (value < 0.6) return "Balanced";
    if (value < 0.8) return "Niche";
    return "Deep Niche";
}

function normalizeTitle(str) {
    return (str || "")
        .toLowerCase()
        .replace(/\(\d{4}\)/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenSet(str) {
    return new Set(normalizeTitle(str).split(" ").filter(Boolean));
}

function setLoadingState(message) {
    d3.select("#recommendation-status").text(message);
    d3.select("#heatmap-status").text(message);
    d3.select("#graph-status").text(message);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function transformPoint(point) {
    return {
        x: point.sx * transformState.scale + transformState.tx,
        y: point.sy * transformState.scale + transformState.ty
    };
}

function inverseTransform(screenX, screenY) {
    return {
        x: (screenX - transformState.tx) / transformState.scale,
        y: (screenY - transformState.ty) / transformState.scale
    };
}

function setTransform(scale, tx, ty) {
    transformState.scale = clamp(scale, 0.7, 6);
    transformState.tx = tx;
    transformState.ty = ty;
}

setLoadingState("Loading artifacts...");

Promise.all([
    d3.json("output/movie_map.json"),
    d3.json("output/baseline_top100.json"),
    d3.json("output/popularity.json"),
    d3.json("output/title_index.json"),
    d3.json("output/cf_neighbors_topk.json"),
    d3.json("output/mf_neighbors_topk.json")
]).then(([mapData, baselineData, popularityData, titleIndexData, cfNeighborData, mfNeighborData]) => {
    const xScale = d3.scaleLinear()
        .domain(d3.extent(mapData, d => d.x))
        .range([50, width - 50]);

    const yScale = d3.scaleLinear()
        .domain(d3.extent(mapData, d => d.y))
        .range([height - 50, 50]);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    const popularityById = new Map(popularityData.map(d => [d.movieId, d]));
    const baselineRankById = new Map(baselineData.map((d, idx) => [d.movieId, idx + 1]));
    const cfNeighborsById = new Map(cfNeighborData.map(d => [d.movieId, d.neighbors || []]));
    const mfNeighborsById = new Map(mfNeighborData.map(d => [d.movieId, d.neighbors || []]));
    const movieById = new Map();
    const titleIndexByMovieId = new Map();

    const BINS = 100;
    const BIN_WINDOW = 12;
    const DRAG_POINT_LIMIT = 4500;
    const nicheBins = Array.from({ length: BINS }, () => []);

    const points = mapData.map(movie => {
        const pop = popularityById.get(movie.movieId);
        const nicheScore = pop ? pop.niche_score : (movie.niche_score ?? 1);
        const point = {
            ...movie,
            popularity_score: pop ? pop.popularity_score : movie.popularity_score,
            popularity_tier: pop ? pop.popularity_tier : movie.popularity_tier,
            niche_score: nicheScore,
            sx: xScale(movie.x),
            sy: yScale(movie.y),
            genreKey: movie.genres ? movie.genres.split("|")[0] : "(no genres listed)"
        };
        const bin = Math.max(0, Math.min(BINS - 1, Math.floor(nicheScore * (BINS - 1))));
        nicheBins[bin].push(point);
        movieById.set(point.movieId, point);
        return point;
    });

    for (const row of titleIndexData) {
        if (movieById.has(row.movieId)) {
            titleIndexByMovieId.set(row.movieId, row);
        }
    }

    availableTitleRows = Array.from(titleIndexByMovieId.values())
        .map(row => ({
            ...row,
            popularityScore: popularityById.get(row.movieId)?.popularity_score || 0
        }))
        .sort((a, b) => b.popularityScore - a.popularityScore);

    baselineRecommendations = baselineData
        .map(row => {
            const point = movieById.get(row.movieId);
            const pop = popularityById.get(row.movieId);
            return point ? {
                movieId: row.movieId,
                title: row.title,
                genres: row.genres,
                year: titleIndexByMovieId.get(row.movieId)?.year || "",
                cfRaw: 0,
                mfRaw: 0,
                cfScore: 0,
                mfScore: 0,
                blendedScore: row.popularity_score || 0,
                nicheFit: pop ? 1 - Math.abs(pop.niche_score - nichePreference) : 0,
                popularityScore: row.popularity_score || 0,
                popularityTier: row.popularity_tier || "Unknown",
                isOverlap: false,
                reasonText: "Global popularity baseline",
                cfReasons: [],
                mfReasons: []
            } : null;
        })
        .filter(Boolean);

    const yearRegex = /\((\d{4})\)/;
    function extractDecade(title) {
        const match = (title || "").match(yearRegex);
        if (!match) return "Unknown";
        const year = +match[1];
        if (!Number.isFinite(year)) return "Unknown";
        return `${Math.floor(year / 10) * 10}s`;
    }

    const catalogGenreCounts = new Map();
    const catalogDecadesSet = new Set();
    const catalogCellCounts = new Map();
    for (const point of points) {
        const genre = point.genreKey || "(no genres listed)";
        const decade = extractDecade(point.title);
        catalogDecadesSet.add(decade);
        catalogGenreCounts.set(genre, (catalogGenreCounts.get(genre) || 0) + 1);
        const key = `${genre}|${decade}`;
        catalogCellCounts.set(key, (catalogCellCounts.get(key) || 0) + 1);
    }
    const heatmapGenres = Array.from(catalogGenreCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([genre]) => genre);
    const heatmapDecades = Array.from(catalogDecadesSet)
        .sort((a, b) => {
            if (a === "Unknown") return 1;
            if (b === "Unknown") return -1;
            return parseInt(a, 10) - parseInt(b, 10);
        });
    const catalogTotalInHeatmap = points.filter(point => heatmapGenres.includes(point.genreKey || "(no genres listed)")).length;

    function mergeUniqueByMovieId(base, extra) {
        if (!extra.length) return base;
        const seen = new Set(base.map(point => point.movieId));
        const merged = base.slice();
        for (const point of extra) {
            if (!seen.has(point.movieId)) {
                seen.add(point.movieId);
                merged.push(point);
            }
        }
        return merged;
    }

    function getCandidatesByNiche(preference) {
        const center = Math.max(0, Math.min(BINS - 1, Math.round(preference * (BINS - 1))));
        const start = Math.max(0, center - BIN_WINDOW);
        const end = Math.min(BINS - 1, center + BIN_WINDOW);
        let candidates = [];
        for (let i = start; i <= end; i++) candidates = candidates.concat(nicheBins[i]);
        return candidates;
    }

    function sampleForDrag(candidates, maxPoints) {
        if (candidates.length <= maxPoints) return candidates;
        const step = candidates.length / maxPoints;
        const sampled = [];
        for (let i = 0; i < maxPoints; i++) sampled.push(candidates[Math.floor(i * step)]);
        const favorites = Array.from(favoriteMovieIds).map(id => movieById.get(id)).filter(Boolean);
        return mergeUniqueByMovieId(sampled, favorites);
    }

    function getCurrentModeLabel() {
        switch (currentListView) {
            case "cf": return "CF";
            case "mf": return "MF";
            case "overlap": return "Overlap";
            case "baseline": return "Baseline";
            default: return "All";
        }
    }

    function getActiveRecommendations() {
        switch (currentListView) {
            case "cf":
                return cfRecommendations;
            case "mf":
                return mfRecommendations;
            case "overlap":
                return overlapRecommendations;
            case "baseline":
                return baselineRecommendations.map(rec => ({
                    ...rec,
                    nicheFit: 1 - Math.abs((popularityById.get(rec.movieId)?.niche_score || 0) - nichePreference)
                }));
            default:
                return blendedRecommendations;
        }
    }

    function getActiveRecommendationIds() {
        return new Set(getActiveRecommendations().map(rec => rec.movieId));
    }

    function getReasonText(rec) {
        const cfReason = rec.cfReasons && rec.cfReasons.length
            ? `CF via ${rec.cfReasons.map(r => r.title).join(", ")}`
            : null;
        const mfReason = rec.mfReasons && rec.mfReasons.length
            ? `MF via ${rec.mfReasons.map(r => r.title).join(", ")}`
            : null;
        return [cfReason, mfReason].filter(Boolean).join(" | ") || rec.reasonText || "No algorithm explanation available";
    }

    function renderAnchorSummary() {
        const container = d3.select("#selected-anchors");
        container.selectAll("*").remove();
        if (!currentAnchorPoints.length) {
            container.append("span").attr("class", "chip").text("No anchors selected yet");
            return;
        }
        currentAnchorPoints.forEach(anchor => {
            const titleRow = titleIndexByMovieId.get(anchor.movieId);
            container.append("span")
                .attr("class", "chip")
                .text(`${anchor.title} • ${titleRow?.genres || anchor.genres}`);
        });
    }

    function renderRecommendationList() {
        const root = d3.select("#recommendation-list");
        root.selectAll("*").remove();

        const rows = getActiveRecommendations().slice(0, 10);
        d3.select("#recommendation-status").text(
            currentAnchorPoints.length || currentListView === "baseline"
                ? `Source: ${getCurrentModeLabel()} | map, heatmap, graph, and list are synchronized.`
                : "Build a profile to generate real CF, MF, overlap, and blended recommendation lists."
        );

        const header = root.append("div").attr("class", "rec-row header");
        ["Movie", "CF score", "MF score", "Niche fit", "Popularity"].forEach(label => {
            header.append("div").text(label);
        });

        if (!rows.length) {
            const empty = root.append("div").attr("class", "rec-row");
            empty.append("div").text("No recommendations yet.");
            empty.append("div").text("-");
            empty.append("div").text("-");
            empty.append("div").text("-");
            empty.append("div").text("-");
            return;
        }

        rows.forEach(rec => {
            const row = root.append("div").attr("class", "rec-row");
            const left = row.append("div");
            left.append("div").attr("class", "rec-title").text(rec.title);
            left.append("div").attr("class", "rec-meta").text(`${rec.genres || "Unknown"} | ${getReasonText(rec)}`);

            row.append("div").html(`<div>${rec.cfScore.toFixed(3)}</div><div class="metric-label">raw ${rec.cfRaw.toFixed(3)}</div>`);
            row.append("div").html(`<div>${rec.mfScore.toFixed(3)}</div><div class="metric-label">raw ${rec.mfRaw.toFixed(3)}</div>`);
            row.append("div").html(`<div>${rec.nicheFit.toFixed(3)}</div><div class="metric-label">${preferenceLabel(nichePreference)}</div>`);
            row.append("div").html(`<div>${rec.popularityTier}</div><div class="metric-label">${Math.round(rec.popularityScore * 100)} / 100</div>`);
        });
    }

    function draw(pointsToDraw) {
        ctx.clearRect(0, 0, width, height);
        const activeRecommendationIds = getActiveRecommendationIds();

        for (const point of pointsToDraw) {
            const transformed = transformPoint(point);
            if (transformed.x < -24 || transformed.x > width + 24 || transformed.y < -24 || transformed.y > height + 24) {
                continue;
            }

            const distance = Math.abs(point.niche_score - nichePreference);
            const fit = 1 - Math.min(distance / 0.40, 1);
            const baseRadius = (2.4 + fit * 1.8) * transformState.scale;
            const radius = clamp(baseRadius, 1.4, 16);
            const opacity = 0.07 + 0.86 * fit;
            const isFavorite = favoriteMovieIds.has(point.movieId);
            const isRecommended = activeRecommendationIds.has(point.movieId);

            ctx.beginPath();
            ctx.arc(transformed.x, transformed.y, isFavorite ? radius + 2.2 : radius, 0, Math.PI * 2);
            if (isFavorite) {
                ctx.fillStyle = "rgba(255, 215, 0, 0.95)";
            } else if (isRecommended) {
                ctx.fillStyle = currentListView === "mf"
                    ? "rgba(220, 38, 38, 0.88)"
                    : currentListView === "overlap"
                        ? "rgba(124, 58, 237, 0.90)"
                        : currentListView === "baseline"
                            ? "rgba(80, 80, 80, 0.80)"
                            : "rgba(45, 205, 255, 0.90)";
            } else {
                ctx.fillStyle = d3.color(colorScale(point.genreKey)).copy({ opacity }).formatRgb();
            }
            ctx.fill();

            if (isFavorite) {
                ctx.beginPath();
                ctx.arc(transformed.x, transformed.y, radius + 3.3, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(25, 25, 25, 0.95)";
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }

            if (isRecommended) {
                ctx.beginPath();
                ctx.arc(transformed.x, transformed.y, radius + 2.6, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
                ctx.lineWidth = 1.1;
                ctx.stroke();
            }

            if (point.movieId === selectedMovieId) {
                ctx.beginPath();
                ctx.arc(transformed.x, transformed.y, radius + 5, 0, Math.PI * 2);
                ctx.strokeStyle = "#111";
                ctx.lineWidth = 1.8;
                ctx.stroke();
            }
        }

        renderedPoints = pointsToDraw;
    }

    function renderHeatmap() {
        const sourceRecs = getActiveRecommendations();
        const sourceLabel = getCurrentModeLabel();

        const cellWidth = 54;
        const cellHeight = 22;
        const margin = { top: 26, right: 12, bottom: 48, left: 110 };
        const innerWidth = heatmapDecades.length * cellWidth;
        const innerHeight = heatmapGenres.length * cellHeight;
        const svgWidth = margin.left + innerWidth + margin.right;
        const svgHeight = margin.top + innerHeight + margin.bottom;

        const recPoints = sourceRecs
            .map(rec => movieById.get(rec.movieId))
            .filter(Boolean)
            .filter(point => heatmapGenres.includes(point.genreKey || "(no genres listed)"));
        const recTotal = recPoints.length;

        const recCellCounts = new Map();
        for (const point of recPoints) {
            const key = `${point.genreKey || "(no genres listed)"}|${extractDecade(point.title)}`;
            recCellCounts.set(key, (recCellCounts.get(key) || 0) + 1);
        }

        const cells = [];
        for (const genre of heatmapGenres) {
            for (const decade of heatmapDecades) {
                const key = `${genre}|${decade}`;
                const catalogShare = catalogTotalInHeatmap ? (catalogCellCounts.get(key) || 0) / catalogTotalInHeatmap : 0;
                let recShare = catalogShare;
                if (recTotal > 0) recShare = (recCellCounts.get(key) || 0) / recTotal;
                cells.push({ genre, decade, delta: recShare - catalogShare, recShare, catalogShare });
            }
        }

        const maxAbs = Math.max(0.02, d3.max(cells, d => Math.abs(d.delta)) || 0.02);
        const color = d3.scaleDiverging()
            .domain([-maxAbs, 0, maxAbs])
            .interpolator(d3.interpolateRdBu);

        const root = d3.select("#heatmap");
        root.selectAll("*").remove();
        const hsvg = root.append("svg")
            .attr("width", svgWidth)
            .attr("height", svgHeight);
        const g = hsvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        g.selectAll("rect")
            .data(cells)
            .enter()
            .append("rect")
            .attr("x", d => heatmapDecades.indexOf(d.decade) * cellWidth)
            .attr("y", d => heatmapGenres.indexOf(d.genre) * cellHeight)
            .attr("width", cellWidth - 1)
            .attr("height", cellHeight - 1)
            .attr("fill", d => color(d.delta))
            .append("title")
            .text(d =>
                `${d.genre} | ${d.decade}\n` +
                `Rec share: ${(d.recShare * 100).toFixed(2)}%\n` +
                `Catalog share: ${(d.catalogShare * 100).toFixed(2)}%\n` +
                `Delta: ${(d.delta * 100).toFixed(2)} pp`
            );

        g.selectAll(".row-label")
            .data(heatmapGenres)
            .enter()
            .append("text")
            .attr("x", -8)
            .attr("y", (_, i) => i * cellHeight + cellHeight / 2)
            .attr("dy", "0.32em")
            .attr("text-anchor", "end")
            .style("font-size", "11px")
            .text(d => d);

        g.selectAll(".col-label")
            .data(heatmapDecades)
            .enter()
            .append("text")
            .attr("x", (_, i) => i * cellWidth + cellWidth / 2)
            .attr("y", innerHeight + 14)
            .attr("text-anchor", "middle")
            .style("font-size", "11px")
            .text(d => d);

        d3.select("#heatmap-status").text(
            recTotal > 0
                ? `Heatmap source: ${sourceLabel} | recommendation count: ${recTotal} | niche slider: ${preferenceLabel(nichePreference)}`
                : "Build a profile to compare recommendation distribution vs full catalog."
        );
    }

    function renderRecommendationGraph() {
        const graphSvg = d3.select("#reco-graph");
        graphSvg.selectAll("*").remove();

        const graphWidth = +graphSvg.attr("width");
        const graphHeight = +graphSvg.attr("height");
        if (!currentAnchorPoints.length) {
            d3.select("#graph-status").text("Build a profile to visualize your recommendation neighborhood.");
            return;
        }

        const anchorIds = new Set(currentAnchorPoints.map(anchor => anchor.movieId));
        const activeRecs = getActiveRecommendations().slice(0, 12).filter(rec => !anchorIds.has(rec.movieId));

        const nodes = [{ id: "you", label: "You", type: "user", movieId: null }];
        const links = [];
        const nodeById = new Map([["you", nodes[0]]]);

        function nodeTypeForRec(rec) {
            if (currentListView === "baseline") return "baseline";
            if (rec.isOverlap) return "overlap";
            if (currentListView === "cf") return "cf";
            if (currentListView === "mf") return "mf";
            if (rec.cfRaw > 0 && rec.mfRaw > 0) return "overlap";
            if (rec.cfRaw > 0 && rec.mfRaw === 0) return "cf";
            if (rec.mfRaw > 0 && rec.cfRaw === 0) return "mf";
            return "blended";
        }

        currentAnchorPoints.forEach((anchor, idx) => {
            const key = `m-${anchor.movieId}`;
            const label = anchor.title.replace(/\(\d{4}\)/, "").trim();
            nodeById.set(key, {
                id: key,
                movieId: anchor.movieId,
                label: label.length > 24 ? `${label.slice(0, 24)}...` : label,
                fullTitle: anchor.title,
                type: "anchor"
            });
            nodes.push(nodeById.get(key));
            links.push({ source: "you", target: key, weight: 1.5, kind: "anchor" });
        });

        activeRecs.forEach(rec => {
            const key = `m-${rec.movieId}`;
            const point = movieById.get(rec.movieId);
            if (!point || nodeById.has(key)) return;
            const label = point.title.replace(/\(\d{4}\)/, "").trim();
            nodes.push({
                id: key,
                movieId: rec.movieId,
                label: label.length > 24 ? `${label.slice(0, 24)}...` : label,
                fullTitle: point.title,
                type: nodeTypeForRec(rec)
            });
            nodeById.set(key, nodes[nodes.length - 1]);
            const weightBase = currentListView === "cf" ? rec.cfScore
                : currentListView === "mf" ? rec.mfScore
                    : currentListView === "baseline" ? rec.blendedScore
                        : rec.blendedScore;
            links.push({ source: "you", target: key, weight: 0.8 + weightBase * 1.6, kind: nodeTypeForRec(rec) });
        });

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(d => 118 - Math.min(52, d.weight * 18)).strength(0.58))
            .force("charge", d3.forceManyBody().strength(-230))
            .force("center", d3.forceCenter(graphWidth / 2, graphHeight / 2))
            .force("collision", d3.forceCollide().radius(d => d.type === "user" ? 28 : 16));

        const link = graphSvg.append("g")
            .attr("stroke-linecap", "round")
            .selectAll("line")
            .data(links)
            .enter()
            .append("line")
            .attr("stroke", d => d.kind === "mf" ? "rgba(220,38,38,0.45)"
                : d.kind === "cf" ? "rgba(37,99,235,0.45)"
                    : d.kind === "baseline" ? "rgba(90,90,90,0.45)"
                        : d.kind === "anchor" ? "rgba(240,187,0,0.6)"
                            : "rgba(124,58,237,0.55)")
            .attr("stroke-width", d => 1 + d.weight * 1.2);

        const node = graphSvg.append("g")
            .selectAll("g")
            .data(nodes)
            .enter()
            .append("g")
            .style("cursor", d => d.movieId ? "pointer" : "default")
            .on("click", (_, d) => {
                if (!d.movieId) return;
                const point = movieById.get(d.movieId);
                if (!point) return;
                selectedMovieId = d.movieId;
                applyNichePreferenceView(false);
                updateDetailsPanel(point);
            });

        node.append("circle")
            .attr("r", d => d.type === "user" ? 16 : d.type === "anchor" ? 9 : 7)
            .attr("fill", d => d.type === "user" ? "#222"
                : d.type === "anchor" ? "#ffd700"
                    : d.type === "cf" ? "#2563eb"
                        : d.type === "mf" ? "#dc2626"
                            : d.type === "baseline" ? "#666"
                                : "#7c3aed")
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);

        node.append("text")
            .attr("dy", d => d.type === "user" ? 30 : 16)
            .attr("text-anchor", "middle")
            .style("font-size", "10px")
            .style("fill", "#333")
            .text(d => d.type === "user" ? "You" : d.label);

        node.append("title").text(d => d.fullTitle || d.label);

        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            node.attr("transform", d => `translate(${d.x},${d.y})`);
        });

        d3.select("#graph-status").text(
            `Graph source: ${getCurrentModeLabel()} | anchors: ${currentAnchorPoints.length} | visible nodes: ${activeRecs.length}`
        );
    }

    function recomputeRecommendationsFromAnchors(useNicheSubset = false) {
        if (!currentAnchorPoints.length) {
            cfRecommendations = [];
            mfRecommendations = [];
            overlapRecommendations = [];
            blendedRecommendations = [];
            recommendationScoreById = new Map();
            renderRecommendationList();
            renderHeatmap();
            renderRecommendationGraph();
            return;
        }

        const anchorSet = new Set(currentAnchorPoints.map(anchor => anchor.movieId));
        const allowedIds = useNicheSubset ? new Set(getCandidatesByNiche(nichePreference).map(point => point.movieId)) : null;

        const cfRawById = new Map();
        const mfRawById = new Map();
        const cfReasonsById = new Map();
        const mfReasonsById = new Map();

        function accumulate(anchor, neighbors, rawById, reasonsById) {
            for (const neighbor of neighbors || []) {
                if (anchorSet.has(neighbor.movieId)) continue;
                if (!movieById.has(neighbor.movieId)) continue;
                if (allowedIds && !allowedIds.has(neighbor.movieId)) continue;
                rawById.set(neighbor.movieId, (rawById.get(neighbor.movieId) || 0) + neighbor.score);
                if (!reasonsById.has(neighbor.movieId)) reasonsById.set(neighbor.movieId, []);
                reasonsById.get(neighbor.movieId).push({ movieId: anchor.movieId, title: anchor.title, score: neighbor.score });
            }
        }

        currentAnchorPoints.forEach(anchor => {
            accumulate(anchor, cfNeighborsById.get(anchor.movieId), cfRawById, cfReasonsById);
            accumulate(anchor, mfNeighborsById.get(anchor.movieId), mfRawById, mfReasonsById);
        });

        const allCandidateIds = new Set([...cfRawById.keys(), ...mfRawById.keys()]);
        const maxCf = Math.max(1e-9, ...Array.from(cfRawById.values(), v => v || 0));
        const maxMf = Math.max(1e-9, ...Array.from(mfRawById.values(), v => v || 0));
        const rows = [];

        for (const movieId of allCandidateIds) {
            const point = movieById.get(movieId);
            const pop = popularityById.get(movieId);
            if (!point || !pop) continue;

            const cfRaw = cfRawById.get(movieId) || 0;
            const mfRaw = mfRawById.get(movieId) || 0;
            const cfNorm = cfRaw / maxCf;
            const mfNorm = mfRaw / maxMf;
            const nicheFit = 1 - Math.abs(pop.niche_score - nichePreference);
            const cfScore = 0.8 * cfNorm + 0.2 * nicheFit;
            const mfScore = 0.8 * mfNorm + 0.2 * nicheFit;
            const blendedScore = 0.45 * cfNorm + 0.45 * mfNorm + 0.10 * nicheFit;

            const rec = {
                movieId,
                title: point.title,
                genres: point.genres,
                year: titleIndexByMovieId.get(movieId)?.year || "",
                cfRaw,
                mfRaw,
                cfScore,
                mfScore,
                blendedScore,
                nicheFit,
                popularityScore: pop.popularity_score,
                popularityTier: pop.popularity_tier,
                isOverlap: cfRaw > 0 && mfRaw > 0,
                cfReasons: (cfReasonsById.get(movieId) || []).sort((a, b) => b.score - a.score).slice(0, 2),
                mfReasons: (mfReasonsById.get(movieId) || []).sort((a, b) => b.score - a.score).slice(0, 2),
                reasonText: ""
            };
            rec.reasonText = getReasonText(rec);
            rows.push(rec);
        }

        cfRecommendations = rows.filter(rec => rec.cfRaw > 0).sort((a, b) => b.cfScore - a.cfScore).slice(0, 60);
        mfRecommendations = rows.filter(rec => rec.mfRaw > 0).sort((a, b) => b.mfScore - a.mfScore).slice(0, 60);
        overlapRecommendations = rows.filter(rec => rec.isOverlap).sort((a, b) => b.blendedScore - a.blendedScore).slice(0, 60);
        blendedRecommendations = rows.sort((a, b) => b.blendedScore - a.blendedScore).slice(0, 60);

        recommendationScoreById = new Map(rows.map(rec => [rec.movieId, rec]));

        renderRecommendationList();
        renderHeatmap();
        renderRecommendationGraph();
    }

    function applyNichePreferenceView(isDragRender = false) {
        let candidates = getCandidatesByNiche(nichePreference);
        const favorites = Array.from(favoriteMovieIds).map(id => movieById.get(id)).filter(Boolean);
        const recommendations = getActiveRecommendations().map(rec => movieById.get(rec.movieId)).filter(Boolean);
        const selected = selectedMovieId ? [movieById.get(selectedMovieId)].filter(Boolean) : [];
        candidates = mergeUniqueByMovieId(candidates, favorites);
        candidates = mergeUniqueByMovieId(candidates, recommendations);
        candidates = mergeUniqueByMovieId(candidates, selected);
        const drawSet = isDragRender ? sampleForDrag(candidates, DRAG_POINT_LIMIT) : candidates;
        draw(drawSet);
    }

    function scheduleNicheRender(isDragRender = false) {
        if (nicheAnimationFrame) cancelAnimationFrame(nicheAnimationFrame);
        nicheAnimationFrame = requestAnimationFrame(() => {
            nichePreference = pendingNichePreference;
            applyNichePreferenceView(isDragRender);
        });
    }

    function updateDetailsPanel(point) {
        const pop = popularityById.get(point.movieId);
        const rec = recommendationScoreById.get(point.movieId);
        const baselineRank = baselineRankById.get(point.movieId);
        const cfInfo = rec ? rec.cfScore.toFixed(3) : "0.000";
        const mfInfo = rec ? rec.mfScore.toFixed(3) : "0.000";
        const overlapText = rec ? (rec.isOverlap ? "Yes" : "No") : "No";
        const whyText = rec ? getReasonText(rec) : (baselineRank ? "Included in global popularity baseline." : "This movie is not in the current recommendation list.");
        const sliderFit = pop ? Math.round((1 - Math.abs(pop.niche_score - nichePreference)) * 100) : 0;

        d3.select("#movie-info").html(`
            <strong>Title:</strong> ${point.title}<br>
            <strong>Genres:</strong> ${point.genres}<br>
            <small>Map Vector: [${point.x.toFixed(2)}, ${point.y.toFixed(2)}]</small>
        `);

        d3.select("#comparison-stats").html(`
            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee; margin-top: 10px;">
                <p>Popularity Tier: <strong>${pop?.popularity_tier || "Unknown"}</strong> (${Math.round((pop?.popularity_percentile || 0) * 100)}th percentile)</p>
                <p>Fame Score: ${Math.round((pop?.popularity_score || 0) * 100)} / 100 | Niche Score: ${Math.round((pop?.niche_score || 0) * 100)} / 100</p>
                <p>CF score: ${cfInfo} | MF score: ${mfInfo}</p>
                <p>In overlap: ${overlapText} | Slider Fit: ${sliderFit}%</p>
                <p>Baseline rank: ${baselineRank ? `Top 100 #${baselineRank}` : "Not in Top 100"}</p>
                <p style="font-size: 0.9em; color: #666; margin-top: 10px; border-top: 1px solid #ddd; padding-top: 5px;">
                    <strong>Why recommended:</strong> ${whyText}
                </p>
            </div>
        `);
    }

    function setActiveListView(nextView) {
        currentListView = nextView;
        d3.selectAll(".list-tab").classed("active", false);
        d3.selectAll(`.list-tab[data-list-view="${nextView}"]`).classed("active", true);
        renderRecommendationList();
        renderHeatmap();
        renderRecommendationGraph();
        applyNichePreferenceView(false);
    }

    function resolveInputSelection(input) {
        const selectedId = input.dataset.selectedMovieId;
        if (!selectedId) return null;
        return movieById.get(Number(selectedId)) || null;
    }

    function updateAnchorChip(field, row) {
        const chip = field.querySelector(".anchor-chip");
        chip.innerHTML = "";
        if (!row) return;
        const span = document.createElement("span");
        span.className = "chip";
        span.textContent = `${row.title} • ${row.genres}`;
        chip.appendChild(span);
    }

    function hideSuggestions(field) {
        const box = field.querySelector(".suggestion-box");
        box.style.display = "none";
        box.innerHTML = "";
    }

    function selectSuggestion(field, row) {
        const input = field.querySelector(".movie-input");
        input.value = row.title;
        input.dataset.selectedMovieId = String(row.movieId);
        input.dataset.selectedMovieTitle = row.title;
        updateAnchorChip(field, row);
        hideSuggestions(field);
    }

    function findSuggestions(query) {
        const q = normalizeTitle(query);
        if (q.length < 2) return [];
        const qTokens = tokenSet(query);
        const suggestions = [];
        for (const row of availableTitleRows) {
            let score = -1;
            if (row.normalized_title === q) {
                score = 200;
            } else if (row.normalized_title.startsWith(q)) {
                score = 170;
            } else if (row.normalized_title.includes(` ${q} `) || row.normalized_title.includes(q)) {
                score = 140;
            } else {
                const overlap = Array.from(qTokens).reduce((count, token) => count + (row.normalized_title.includes(token) ? 1 : 0), 0);
                if (overlap > 0) score = 80 + overlap * 10;
            }
            if (score < 0) continue;
            suggestions.push({ row, score: score + row.popularityScore * 10 });
            if (suggestions.length >= 12) break;
        }
        return suggestions.sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.row);
    }

    function setupAutocomplete() {
        document.querySelectorAll(".anchor-field").forEach(field => {
            const input = field.querySelector(".movie-input");
            const box = field.querySelector(".suggestion-box");

            input.addEventListener("input", () => {
                if (input.dataset.selectedMovieTitle !== input.value) {
                    delete input.dataset.selectedMovieId;
                    delete input.dataset.selectedMovieTitle;
                    updateAnchorChip(field, null);
                }
                const suggestions = findSuggestions(input.value);
                box.innerHTML = "";
                if (!suggestions.length) {
                    hideSuggestions(field);
                    return;
                }
                suggestions.forEach(row => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "suggestion-item";
                    btn.textContent = `${row.title} • ${row.genres}`;
                    btn.addEventListener("mousedown", event => {
                        event.preventDefault();
                        selectSuggestion(field, row);
                    });
                    box.appendChild(btn);
                });
                box.style.display = "block";
            });

            input.addEventListener("focus", () => {
                if (input.value.trim()) {
                    const suggestions = findSuggestions(input.value);
                    if (suggestions.length) {
                        box.innerHTML = "";
                        suggestions.forEach(row => {
                            const btn = document.createElement("button");
                            btn.type = "button";
                            btn.className = "suggestion-item";
                            btn.textContent = `${row.title} • ${row.genres}`;
                            btn.addEventListener("mousedown", event => {
                                event.preventDefault();
                                selectSuggestion(field, row);
                            });
                            box.appendChild(btn);
                        });
                        box.style.display = "block";
                    }
                }
            });

            input.addEventListener("blur", () => {
                setTimeout(() => hideSuggestions(field), 120);
            });
        });
    }

    function resetMapView() {
        setTransform(1, 0, 0);
        applyNichePreferenceView(false);
    }

    function fitToAnchors() {
        if (!currentAnchorPoints.length) {
            resetMapView();
            return;
        }
        const xs = currentAnchorPoints.map(point => point.sx);
        const ys = currentAnchorPoints.map(point => point.sy);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const padding = 80;
        const contentWidth = Math.max(80, maxX - minX);
        const contentHeight = Math.max(80, maxY - minY);
        const scale = clamp(Math.min((width - padding) / contentWidth, (height - padding) / contentHeight), 0.9, 5);
        const tx = width / 2 - ((minX + maxX) / 2) * scale;
        const ty = height / 2 - ((minY + maxY) / 2) * scale;
        setTransform(scale, tx, ty);
        applyNichePreferenceView(false);
    }

    d3.selectAll(".list-tab").on("click", function() {
        setActiveListView(this.dataset.listView);
    });

    d3.select("#map-reset").on("click", resetMapView);
    d3.select("#map-fit-anchors").on("click", fitToAnchors);

    canvas.addEventListener("wheel", event => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const before = inverseTransform(mouseX, mouseY);
        const nextScale = clamp(transformState.scale * (event.deltaY < 0 ? 1.08 : 0.92), 0.7, 6);
        const nextTx = mouseX - before.x * nextScale;
        const nextTy = mouseY - before.y * nextScale;
        setTransform(nextScale, nextTx, nextTy);
        applyNichePreferenceView(false);
    }, { passive: false });

    canvas.addEventListener("mousedown", event => {
        panState.active = true;
        panState.moved = false;
        panState.startX = event.clientX;
        panState.startY = event.clientY;
        panState.tx = transformState.tx;
        panState.ty = transformState.ty;
        canvas.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", event => {
        if (!panState.active) return;
        const dx = event.clientX - panState.startX;
        const dy = event.clientY - panState.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panState.moved = true;
        setTransform(transformState.scale, panState.tx + dx, panState.ty + dy);
        applyNichePreferenceView(false);
    });

    window.addEventListener("mouseup", () => {
        if (!panState.active) return;
        panState.active = false;
        canvas.style.cursor = "grab";
    });

    canvas.addEventListener("click", event => {
        if (panState.moved) {
            panState.moved = false;
            return;
        }

        if (!renderedPoints.length) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        let nearest = null;
        let nearestDist2 = Infinity;
        for (const point of renderedPoints) {
            const transformed = transformPoint(point);
            const dx = transformed.x - mouseX;
            const dy = transformed.y - mouseY;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestDist2) {
                nearestDist2 = d2;
                nearest = point;
            }
        }

        if (!nearest || nearestDist2 > 180) return;
        selectedMovieId = nearest.movieId;
        applyNichePreferenceView(false);
        updateDetailsPanel(nearest);
    });

    d3.select("#niche-slider").on("input", function() {
        pendingNichePreference = +this.value / 100;
        d3.select("#niche-value").text(preferenceLabel(pendingNichePreference));
        scheduleNicheRender(true);
        if (heatmapAnimationFrame) cancelAnimationFrame(heatmapAnimationFrame);
        heatmapAnimationFrame = requestAnimationFrame(() => {
            nichePreference = pendingNichePreference;
            recomputeRecommendationsFromAnchors(true);
            applyNichePreferenceView(true);
        });
    }).on("change", function() {
        pendingNichePreference = +this.value / 100;
        nichePreference = pendingNichePreference;
        recomputeRecommendationsFromAnchors(false);
        scheduleNicheRender(false);
    });
    d3.select("#niche-value").text(preferenceLabel(nichePreference));

    window.personalizeByNames = function() {
        const fields = Array.from(document.querySelectorAll(".anchor-field"));
        const unresolved = fields.filter(field => !resolveInputSelection(field.querySelector(".movie-input")));

        if (unresolved.length) {
            d3.select("#anchor-validation").text("Please choose an exact title from the dropdown for all 5 anchors.");
            return;
        }

        const anchors = fields
            .map(field => resolveInputSelection(field.querySelector(".movie-input")))
            .filter(Boolean);
        const uniqueIds = new Set(anchors.map(anchor => anchor.movieId));
        if (uniqueIds.size < 5) {
            d3.select("#anchor-validation").text("Please choose 5 distinct anchor movies.");
            return;
        }

        d3.select("#anchor-validation").text("");
        currentAnchorPoints = anchors;
        favoriteMovieIds = uniqueIds;
        renderAnchorSummary();
        recomputeRecommendationsFromAnchors(false);
        fitToAnchors();

        const preview = blendedRecommendations.slice(0, 8).map(rec => rec.title).join("; ");
        d3.select("#movie-info").html(`
            <strong>Profile Active!</strong><br>
            Resolved anchors: ${anchors.length} / 5.<br>
            Source mode: ${getCurrentModeLabel()}.<br>
            <small>Top blended picks: ${preview || "N/A"}</small>
        `);
    };

    setupAutocomplete();
    renderAnchorSummary();
    renderRecommendationList();
    applyNichePreferenceView(false);
    renderHeatmap();
    renderRecommendationGraph();
    d3.select("#recommendation-status").text("Artifacts loaded. Select 5 exact anchors from the dropdowns to generate recommendations.");
    d3.select("#heatmap-status").text("Artifacts loaded. Build a profile to compare recommendation distribution vs full catalog.");
    d3.select("#graph-status").text("Artifacts loaded. Build a profile to visualize recommendation overlap.");
}).catch(err => {
    console.error("Initialization Error:", err);
    const message = `Failed to load one or more output artifacts: ${err}`;
    d3.select("#recommendation-status").text(message);
    d3.select("#heatmap-status").text(message);
    d3.select("#graph-status").text(message);
    d3.select("#anchor-validation").text("Artifact load failure. Re-run python build_all.py and refresh.");
});
