const width = 800;
const height = 600;

const canvas = d3.select("#chart")
    .append("canvas")
    .attr("width", width)
    .attr("height", height)
    .style("width", `${width}px`)
    .style("height", `${height}px`)
    .style("display", "block")
    .style("cursor", "crosshair")
    .node();
const ctx = canvas.getContext("2d");

let nichePreference = 0.5; // 0 => mainstream, 1 => deep niche
let pendingNichePreference = nichePreference;
let nicheAnimationFrame = null;
let heatmapAnimationFrame = null;
let favoriteMovieIds = new Set();
let recommendedMovieIds = new Set();
let renderedPoints = [];
let selectedMovieId = null;
let currentAnchorPoints = [];
let cfRecommendationIds = new Set();
let cfRecommendationScores = new Map();

function preferenceLabel(value) {
    if (value < 0.2) return "Mainstream";
    if (value < 0.4) return "Popular";
    if (value < 0.6) return "Balanced";
    if (value < 0.8) return "Niche";
    return "Deep Niche";
}

Promise.all([
    d3.json("output/movie_map.json"),
    d3.json("output/baseline.json"),
    d3.json("output/mf_sample.json"),
    d3.json("output/popularity.json")
]).then(([mapData, baselineData, mfData, popularityData]) => {
    const xScale = d3.scaleLinear()
        .domain(d3.extent(mapData, d => d.x))
        .range([50, width - 50]);

    const yScale = d3.scaleLinear()
        .domain(d3.extent(mapData, d => d.y))
        .range([height - 50, 50]);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    const popularityById = new Map(popularityData.map(d => [d.movieId, d]));
    const baselineSet = new Set(baselineData.map(d => d.movieId));
    const mfSet = new Set(mfData.map(d => d.movieId));
    const movieById = new Map();
    const mfScoreById = new Map(mfData.map(d => [d.movieId, d.pred_score || d.score || 0]));

    const BINS = 100;
    const BIN_WINDOW = 12;
    const DRAG_POINT_LIMIT = 4500;
    const nicheBins = Array.from({ length: BINS }, () => []);

    const points = mapData.map(movie => {
        const pop = popularityById.get(movie.movieId);
        const nicheScore = pop ? pop.niche_score : 1;
        const point = {
            ...movie,
            sx: xScale(movie.x),
            sy: yScale(movie.y),
            niche_score: nicheScore,
            genreKey: movie.genres ? movie.genres.split("|")[0] : "(no genres listed)"
        };
        const bin = Math.max(0, Math.min(BINS - 1, Math.floor(nicheScore * (BINS - 1))));
        nicheBins[bin].push(point);
        movieById.set(point.movieId, point);
        return point;
    });

    // Heatmap setup: compare recommendation mix vs catalog mix by genre x decade.
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
    for (const p of points) {
        const genre = p.genreKey || "(no genres listed)";
        const decade = extractDecade(p.title);
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
    const catalogTotalInHeatmap = points.filter(p => heatmapGenres.includes(p.genreKey || "(no genres listed)")).length;

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

    // Resolve one anchor movie per input term.
    function resolveAnchorForTerm(term, usedMovieIds) {
        const q = (term || "").trim().toLowerCase();
        if (!q) return null;
        const qNorm = normalizeTitle(q);
        const qTokens = tokenSet(q);

        let best = null;
        let bestScore = -Infinity;

        for (const p of points) {
            if (usedMovieIds.has(p.movieId)) continue;
            const title = p.title.toLowerCase();
            const titleNorm = normalizeTitle(title);
            if (!titleNorm) continue;

            let score = -1000;
            if (title === q) {
                score = 250;
            } else if (titleNorm === qNorm) {
                score = 200;
            } else if (titleNorm.includes(qNorm)) {
                score = 150;
            } else {
                // Fuzzy token overlap fallback for partial user input.
                const tTokens = tokenSet(title);
                let overlap = 0;
                for (const token of qTokens) {
                    if (tTokens.has(token)) overlap += 1;
                }
                if (overlap > 0) {
                    score = 80 + (overlap / Math.max(qTokens.size, 1)) * 60;
                }
            }

            if (score < 0) continue;
            const pop = popularityById.get(p.movieId);
            const popBoost = pop ? pop.popularity_score * 10 : 0;
            score += popBoost;

            if (score > bestScore) {
                bestScore = score;
                best = p;
            }
        }
        return best;
    }

    function mergeUniqueByMovieId(base, extra) {
        if (!extra.length) return base;
        const seen = new Set(base.map(p => p.movieId));
        const merged = base.slice();
        for (const p of extra) {
            if (!seen.has(p.movieId)) {
                seen.add(p.movieId);
                merged.push(p);
            }
        }
        return merged;
    }

    function getCandidatesByNiche(preference) {
        const center = Math.max(0, Math.min(BINS - 1, Math.round(preference * (BINS - 1))));
        const start = Math.max(0, center - BIN_WINDOW);
        const end = Math.min(BINS - 1, center + BIN_WINDOW);
        let candidates = [];
        for (let i = start; i <= end; i++) {
            candidates = candidates.concat(nicheBins[i]);
        }
        return candidates;
    }

    function sampleForDrag(candidates, maxPoints) {
        if (candidates.length <= maxPoints) return candidates;
        const step = candidates.length / maxPoints;
        const sampled = [];
        for (let i = 0; i < maxPoints; i++) {
            sampled.push(candidates[Math.floor(i * step)]);
        }
        const favorites = Array.from(favoriteMovieIds).map(id => movieById.get(id)).filter(Boolean);
        return mergeUniqueByMovieId(sampled, favorites);
    }

    function draw(pointsToDraw) {
        ctx.clearRect(0, 0, width, height);

        for (const p of pointsToDraw) {
            const distance = Math.abs(p.niche_score - nichePreference);
            const fit = 1 - Math.min(distance / 0.40, 1);
            const radius = 2.4 + fit * 1.8;
            const opacity = 0.07 + 0.86 * fit;
            const isFavorite = favoriteMovieIds.has(p.movieId);
            const isRecommended = recommendedMovieIds.has(p.movieId);

            ctx.beginPath();
            ctx.arc(p.sx, p.sy, isFavorite ? radius + 2.0 : radius, 0, Math.PI * 2);
            if (isFavorite) {
                ctx.fillStyle = "rgba(255, 215, 0, 0.95)";
            } else if (isRecommended) {
                ctx.fillStyle = "rgba(45, 205, 255, 0.9)";
            } else {
                ctx.fillStyle = d3.color(colorScale(p.genreKey)).copy({ opacity }).formatRgb();
            }
            ctx.fill();

            if (isFavorite) {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, radius + 3.2, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(25, 25, 25, 0.95)";
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
            if (isRecommended) {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, radius + 2.6, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
                ctx.lineWidth = 1.15;
                ctx.stroke();
            }

            if (p.movieId === selectedMovieId) {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, radius + 5, 0, Math.PI * 2);
                ctx.strokeStyle = "#111";
                ctx.lineWidth = 1.8;
                ctx.stroke();
            }
        }

        renderedPoints = pointsToDraw;
    }

    function renderHeatmap() {
        const cellWidth = 54;
        const cellHeight = 22;
        const margin = { top: 26, right: 12, bottom: 48, left: 110 };
        const innerWidth = heatmapDecades.length * cellWidth;
        const innerHeight = heatmapGenres.length * cellHeight;
        const svgWidth = margin.left + innerWidth + margin.right;
        const svgHeight = margin.top + innerHeight + margin.bottom;

        const recPoints = Array.from(recommendedMovieIds)
            .map(id => movieById.get(id))
            .filter(Boolean)
            .filter(p => heatmapGenres.includes(p.genreKey || "(no genres listed)"));
        const recTotal = recPoints.length;

        const recCellCounts = new Map();
        for (const p of recPoints) {
            const key = `${p.genreKey || "(no genres listed)"}|${extractDecade(p.title)}`;
            recCellCounts.set(key, (recCellCounts.get(key) || 0) + 1);
        }

        const cells = [];
        for (const genre of heatmapGenres) {
            for (const decade of heatmapDecades) {
                const key = `${genre}|${decade}`;
                const catalogShare = catalogTotalInHeatmap ? (catalogCellCounts.get(key) || 0) / catalogTotalInHeatmap : 0;
                let recShare = catalogShare;
                if (recTotal > 0) recShare = (recCellCounts.get(key) || 0) / recTotal;
                const delta = recShare - catalogShare;
                cells.push({ genre, decade, key, delta, recShare, catalogShare });
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
                ? `Heatmap updates from ${recTotal} personalized recommendations at niche level ${preferenceLabel(nichePreference)}.`
                : "Build a profile to compare recommended distribution vs full catalog."
        );
    }

    function renderRecommendationGraph() {
        const graphSvg = d3.select("#reco-graph");
        graphSvg.selectAll("*").remove();

        const width = +graphSvg.attr("width");
        const height = +graphSvg.attr("height");
        if (!currentAnchorPoints.length) {
            d3.select("#graph-status").text("Build a profile to visualize your recommendation neighborhood.");
            return;
        }

        const anchorIds = new Set(currentAnchorPoints.map(a => a.movieId));
        const cfIds = Array.from(cfRecommendationIds).filter(id => !anchorIds.has(id)).slice(0, 12);
        const mfIds = Array.from(mfSet)
            .filter(id => !anchorIds.has(id))
            .filter(id => movieById.has(id))
            .slice(0, 12);
        const overlapIds = cfIds.filter(id => mfIds.includes(id));

        const nodes = [{ id: "you", label: "You", type: "user", movieId: null }];
        const links = [];
        const nodeById = new Map();
        nodeById.set("you", nodes[0]);

        function addMovieNode(movieId, type, scoreValue) {
            const key = `m-${movieId}`;
            if (!nodeById.has(key)) {
                const point = movieById.get(movieId);
                if (!point) return;
                const label = (point.title || "").replace(/\(\d{4}\)/, "").trim();
                const node = {
                    id: key,
                    movieId,
                    label: label.length > 26 ? `${label.slice(0, 26)}...` : label,
                    fullTitle: point.title,
                    type,
                    scoreValue
                };
                nodeById.set(key, node);
                nodes.push(node);
            } else if (type === "overlap") {
                nodeById.get(key).type = "overlap";
            }
        }

        currentAnchorPoints.forEach((p, idx) => {
            addMovieNode(p.movieId, "anchor", 1);
            links.push({
                source: "you",
                target: `m-${p.movieId}`,
                weight: 1.4,
                kind: "anchor",
                label: `Anchor ${idx + 1}`
            });
        });

        cfIds.forEach(id => {
            addMovieNode(id, overlapIds.includes(id) ? "overlap" : "cf", cfRecommendationScores.get(id) || 0.5);
            links.push({
                source: "you",
                target: `m-${id}`,
                weight: 0.8 + (cfRecommendationScores.get(id) || 0.4) * 1.8,
                kind: overlapIds.includes(id) ? "overlap" : "cf"
            });
        });

        mfIds.forEach(id => {
            addMovieNode(id, overlapIds.includes(id) ? "overlap" : "mf", mfScoreById.get(id) || 0.3);
            const mfNormalized = Math.min(1, Math.max(0, (mfScoreById.get(id) || 0)));
            links.push({
                source: "you",
                target: `m-${id}`,
                weight: overlapIds.includes(id) ? 1.9 : 0.7 + mfNormalized * 1.3,
                kind: overlapIds.includes(id) ? "overlap" : "mf"
            });
        });

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(d => 120 - Math.min(60, d.weight * 18)).strength(0.55))
            .force("charge", d3.forceManyBody().strength(-220))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(d => d.type === "user" ? 26 : 14));

        const link = graphSvg.append("g")
            .attr("stroke-linecap", "round")
            .selectAll("line")
            .data(links)
            .enter()
            .append("line")
            .attr("stroke", d => d.kind === "mf" ? "rgba(220,38,38,0.45)" :
                d.kind === "cf" ? "rgba(37,99,235,0.45)" :
                    d.kind === "anchor" ? "rgba(240,187,0,0.6)" : "rgba(124,58,237,0.55)")
            .attr("stroke-width", d => 1 + d.weight * 1.3);

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
            .attr("fill", d => d.type === "user" ? "#222" :
                d.type === "anchor" ? "#ffd700" :
                    d.type === "cf" ? "#2563eb" :
                        d.type === "mf" ? "#dc2626" : "#7c3aed")
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
            `Graph view for current profile: ${currentAnchorPoints.length} anchors, ${cfIds.length} CF-like nodes, ${mfIds.length} MF nodes, ${overlapIds.length} overlap.`
        );
    }

    function recomputeRecommendationsFromAnchors(useNicheSubset = false) {
        if (!currentAnchorPoints.length) {
            recommendedMovieIds = new Set();
            renderHeatmap();
            return;
        }

        const anchorSet = new Set(currentAnchorPoints.map(a => a.movieId));
        const sourcePoints = useNicheSubset ? getCandidatesByNiche(nichePreference) : points;
        const scored = [];
        for (const p of sourcePoints) {
            if (anchorSet.has(p.movieId)) continue;
            let minDist = Infinity;
            for (const a of currentAnchorPoints) {
                const dx = p.x - a.x;
                const dy = p.y - a.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) minDist = d;
            }
            const pop = popularityById.get(p.movieId);
            const nicheAlign = pop ? 1 - Math.abs(pop.niche_score - nichePreference) : 0.5;
            const score = (1 / (1 + minDist)) * 0.8 + nicheAlign * 0.2;
            scored.push({ point: p, score });
        }

        scored.sort((a, b) => b.score - a.score);
        const topRecommendations = scored.slice(0, 60).map(s => s.point);
        recommendedMovieIds = new Set(topRecommendations.map(r => r.movieId));
        cfRecommendationIds = new Set(topRecommendations.map(r => r.movieId));
        cfRecommendationScores = new Map(topRecommendations.map(r => {
            const scoreObj = scored.find(s => s.point.movieId === r.movieId);
            return [r.movieId, scoreObj ? scoreObj.score : 0];
        }));
        for (const m of mfData) {
            if (!anchorSet.has(m.movieId)) recommendedMovieIds.add(m.movieId);
        }
        renderHeatmap();
        renderRecommendationGraph();
    }

    function applyNichePreferenceView(isDragRender = false) {
        let candidates = getCandidatesByNiche(nichePreference);
        const favorites = Array.from(favoriteMovieIds).map(id => movieById.get(id)).filter(Boolean);
        const recommendations = Array.from(recommendedMovieIds).map(id => movieById.get(id)).filter(Boolean);
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

    function updateDetailsPanel(d) {
        const inputs = document.querySelectorAll(".movie-input");
        const myFavNames = Array.from(inputs).map(i => i.value.toLowerCase().trim()).filter(t => t !== "");
        const anchorMovies = mapData.filter(m => myFavNames.some(name => m.title.toLowerCase().includes(name)));

        const DISTANCE_THRESHOLD = 8;
        const isNearAnchor = anchorMovies.some(anchor => {
            const dist = Math.sqrt(Math.pow(d.x - anchor.x, 2) + Math.pow(d.y - anchor.y, 2));
            return dist < DISTANCE_THRESHOLD;
        });

        const isExactFavorite = favoriteMovieIds.has(d.movieId);
        const inBaseline = baselineSet.has(d.movieId);
        const inMF = mfSet.has(d.movieId);
        const inRecommendations = recommendedMovieIds.has(d.movieId);
        const pop = popularityById.get(d.movieId);
        const popularityScore = pop ? pop.popularity_score : 0;
        const nicheScore = pop ? pop.niche_score : 1;
        const popularityPercentile = pop ? Math.round(pop.popularity_percentile * 100) : 0;
        const sliderFit = Math.round((1 - Math.abs(nicheScore - nichePreference)) * 100);
        const tier = pop ? pop.popularity_tier : "Unknown";
        const isPersonalMatch = isExactFavorite || isNearAnchor || inMF || inRecommendations;

        let explanation = "";
        if (isExactFavorite) {
            explanation = "<strong>Personal Anchor:</strong> This is one of your top 5 favorite movies!";
        } else if (inRecommendations) {
            explanation = "<strong>Recommended:</strong> This was selected from your personalized neighborhood (excluding your input anchors).";
        } else if (isNearAnchor) {
            explanation = "<strong>Neighborhood Match:</strong> This movie is mathematically similar (spatially close) to your favorites.";
        } else if (inMF) {
            explanation = "<strong>Algorithmic Suggestion:</strong> Our model identifies this as a high-match for your latent profile.";
        } else if (popularityScore > 0.85) {
            explanation = "<strong>Mainstream Signal:</strong> This title is broadly popular across the user base.";
        } else if (popularityScore < 0.25) {
            explanation = "<strong>Niche Signal:</strong> This title lives in the long-tail of the catalog.";
        } else {
            explanation = "<strong>Discovery Zone:</strong> This movie sits outside your current taste clusters.";
        }

        d3.select("#movie-info").html(`
            <strong>Title:</strong> ${d.title}<br>
            <strong>Genres:</strong> ${d.genres}<br>
            <small>Map Vector: [${d.x.toFixed(2)}, ${d.y.toFixed(2)}]</small>
        `);

        d3.select("#comparison-stats").html(`
            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee; margin-top: 10px;">
                <p>Popularity Tier: <strong>${tier}</strong> (${popularityPercentile}th percentile)</p>
                <p>Fame Score: ${Math.round(popularityScore * 100)} / 100 | Niche Score: ${Math.round(nicheScore * 100)} / 100</p>
                <p>Slider Fit: ${sliderFit}% match to your niche preference</p>
                <p>Top-100 Presence: ${inBaseline ? "✅ Yes" : "No"}</p>
                <p>Personalized Match: ${isPersonalMatch ? "✅ High" : "❌ Low"}</p>
                <p style="font-size: 0.9em; color: #666; margin-top: 10px; border-top: 1px solid #ddd; padding-top: 5px;">${explanation}</p>
            </div>
        `);
    }

    canvas.addEventListener("click", event => {
        if (!renderedPoints.length) return;
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;

        let nearest = null;
        let nearestDist2 = Infinity;
        for (const p of renderedPoints) {
            const dx = p.sx - mx;
            const dy = p.sy - my;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestDist2) {
                nearestDist2 = d2;
                nearest = p;
            }
        }

        if (!nearest || nearestDist2 > 120) return;
        selectedMovieId = nearest.movieId;
        applyNichePreferenceView(false);
        updateDetailsPanel(nearest);
    });

    // Slider behavior kept, now backed by bins + sampled drag rendering.
    d3.select("#niche-slider").on("input", function() {
        pendingNichePreference = +this.value / 100;
        d3.select("#niche-value").text(preferenceLabel(pendingNichePreference));
        scheduleNicheRender(true);
        // Lightweight live update while dragging.
        if (heatmapAnimationFrame) cancelAnimationFrame(heatmapAnimationFrame);
        heatmapAnimationFrame = requestAnimationFrame(() => {
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

    // Original personalization behavior retained.
    window.personalizeByNames = function() {
        const inputs = document.querySelectorAll(".movie-input");
        const searchTerms = Array.from(inputs)
            .map(i => i.value.trim().toLowerCase())
            .filter(t => t !== "");

        if (searchTerms.length < 5) return alert("Enter all 5 movies to anchor your map!");

        const usedMovieIds = new Set();
        const anchors = searchTerms
            .map(term => resolveAnchorForTerm(term, usedMovieIds))
            .filter(Boolean);
        anchors.forEach(a => usedMovieIds.add(a.movieId));
        const myFavorites = anchors;
        currentAnchorPoints = myFavorites;
        favoriteMovieIds = new Set(myFavorites.map(m => m.movieId));

        recomputeRecommendationsFromAnchors(false);
        applyNichePreferenceView(false);

        const topPreview = Array.from(recommendedMovieIds)
            .map(id => movieById.get(id))
            .filter(Boolean)
            .slice(0, 8)
            .map(m => m.title)
            .join("; ");
        d3.select("#movie-info").html(`
            <strong>Profile Active!</strong><br>
            Anchors chosen: ${myFavorites.length} / 5 (yellow).<br>
            Recommendations generated: ${recommendedMovieIds.size} (blue), excluding your input anchors.<br>
            <small>Top picks: ${topPreview || "N/A"}</small>
        `);
    };

    applyNichePreferenceView(false);
    renderHeatmap();
    renderRecommendationGraph();
}).catch(err => console.error("Initialization Error:", err));
