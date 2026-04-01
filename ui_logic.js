const width = 800;
const height = 600;

const svg = d3.select("#chart")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

// 1. Load all pre-computed data files
Promise.all([
    d3.json("output/movie_map.json"),
    d3.json("output/baseline.json"),
    d3.json("output/mf_sample.json")
]).then(([mapData, baselineData, mfData]) => {

    // 2. Setup Scales
    const xScale = d3.scaleLinear()
        .domain(d3.extent(mapData, d => d.x))
        .range([50, width - 50]);

    const yScale = d3.scaleLinear()
        .domain(d3.extent(mapData, d => d.y))
        .range([height - 50, 50]);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

    // 3. Draw the Movie Map dots
    const dots = svg.selectAll("circle")
        .data(mapData)
        .enter()
        .append("circle")
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .attr("r", 4)
        .attr("fill", d => colorScale(d.genres.split('|')[0]))
        .attr("opacity", 0.7)
        .style("cursor", "pointer")
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5);

    // 4. Discovery Slider Logic (Distance-based for 25M scale)
    d3.select("#diversity-slider").on("input", function() {
        const val = +this.value; 
        dots.transition().duration(200)
            .style("opacity", d => {
                const distance = Math.sqrt(d.x * d.x + d.y * d.y);
                // Hide the dense "Mainstream" center as slider moves right
                return (val > 0.5 && distance < 25) ? 0.05 : 0.7;
            });
    });

    // 5. Personalization Function (Global for the HTML button)
    window.personalizeByNames = function() {
        const inputs = document.querySelectorAll(".movie-input");
        const searchTerms = Array.from(inputs)
            .map(i => i.value.trim().toLowerCase())
            .filter(t => t !== "");

        if (searchTerms.length < 5) return alert("Enter all 5 movies to anchor your map!");

        const myFavorites = mapData.filter(d => 
            searchTerms.some(term => d.title.toLowerCase().includes(term))
        );

        dots.transition().duration(800)
            .attr("r", d => myFavorites.some(f => f.movieId === d.movieId) ? 15 : 3)
            .attr("fill", d => myFavorites.some(f => f.movieId === d.movieId) ? "#FFD700" : colorScale(d.genres.split('|')[0]))
            .style("opacity", d => myFavorites.some(f => f.movieId === d.movieId) ? 1 : 0.2)
            .attr("stroke", d => myFavorites.some(f => f.movieId === d.movieId) ? "#000" : "#fff")
            .attr("stroke-width", d => myFavorites.some(f => f.movieId === d.movieId) ? 3 : 0.5);

        d3.select("#movie-info").html(`<strong>Profile Active!</strong> Found ${myFavorites.length} matches. Click the yellow dots or nearby clusters.`);
    };

    // 6. Linked View: Interaction Logic (Spatial Proximity Version)
    dots.on("click", function(event, d) {
        // Visual highlight
        dots.attr("stroke", d => d3.select(this).node() === this ? "#000" : "#000")
            .attr("stroke-width", d => d3.select(this).node() === this ? 3 : 0.5);

        // Get Current Inputs
        const inputs = document.querySelectorAll(".movie-input");
        const myFavNames = Array.from(inputs).map(i => i.value.toLowerCase().trim()).filter(t => t !== "");
        
        // Find anchor objects in the data
        const anchorMovies = mapData.filter(m => 
            myFavNames.some(name => m.title.toLowerCase().includes(name))
        );

        // CHECK SPATIAL DISTANCE: Is this dot close to a gold anchor?
        const DISTANCE_THRESHOLD = 8; // Adjust this to grow/shrink the "match" neighborhood
        const isNearAnchor = anchorMovies.some(anchor => {
            const dist = Math.sqrt(Math.pow(d.x - anchor.x, 2) + Math.pow(d.y - anchor.y, 2));
            return dist < DISTANCE_THRESHOLD;
        });

        const isExactFavorite = myFavNames.some(name => d.title.toLowerCase().includes(name));
        const inBaseline = baselineData.some(m => m.movieId === d.movieId);
        const inMF = mfData.some(m => m.movieId === d.movieId);

        // A movie is a "High Match" if it's your favorite, near an anchor, or in the MF list
        const isPersonalMatch = isExactFavorite || isNearAnchor || inMF;

        let explanation = "";
        if (isExactFavorite) {
            explanation = "<strong>Personal Anchor:</strong> This is one of your top 5 favorite movies!";
        } else if (isNearAnchor) {
            explanation = "<strong>Neighborhood Match:</strong> This movie is mathematically similar (spatially close) to your favorites.";
        } else if (inMF) {
            explanation = "<strong>Algorithmic Suggestion:</strong> Our model identifies this as a high-match for your latent profile.";
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
                <p>Popularity Rank: ${inBaseline ? "✅ Top 100" : "❌ Niche"}</p>
                <p>Personalized Match: ${isPersonalMatch ? "✅ High" : "❌ Low"}</p>
                <p style="font-size: 0.9em; color: #666; margin-top: 10px; border-top: 1px solid #ddd; padding-top: 5px;">${explanation}</p>
            </div>
        `);
    });

    dots.append("title").text(d => d.title);

}).catch(err => console.error("Initialization Error:", err));