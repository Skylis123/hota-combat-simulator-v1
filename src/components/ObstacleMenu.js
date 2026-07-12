export function renderObstacleMenu(container, data, state, handlers) {
  container.innerHTML = "";
  const categories = [...new Set(data.obstacles.map((obstacle) => obstacle.category))].sort();
  const selectedCategory = state.obstacleCategory || categories[0];
  const tabs = document.createElement("div");
  tabs.className = "obstacle-category-tabs";
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = category === selectedCategory ? "active" : "";
    button.textContent = category.replaceAll("_", " ");
    button.addEventListener("click", () => handlers.onCategory(category));
    tabs.appendChild(button);
  }
  const hint = document.createElement("small");
  hint.className = "obstacle-hint";
  hint.textContent = "Select an obstacle, then click its bottom-left anchor hex. Right-click a placed obstacle to remove it.";
  const actions = document.createElement("div");
  actions.className = "obstacle-menu-actions";
  actions.innerHTML = `<button type="button" data-auto-obstacles>Auto layout</button><button type="button" data-clear-obstacles>Clear obstacles</button>`;
  actions.querySelector("[data-auto-obstacles]").addEventListener("click", handlers.onAuto);
  actions.querySelector("[data-clear-obstacles]").addEventListener("click", handlers.onClear);
  const grid = document.createElement("div");
  grid.className = "obstacle-cards";
  for (const obstacle of data.obstacles.filter((candidate) => candidate.category === selectedCategory)) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `obstacle-card ${state.selectedObstacleId === obstacle.id ? "selected" : ""}`;
    card.innerHTML = `<img src="./public/${obstacle.image}" alt="" /><span>${obstacle.name}</span><small>${obstacle.blockedTiles.length} blocked hex${obstacle.blockedTiles.length === 1 ? "" : "es"}${obstacle.absolute ? " · fixed" : ""}</small>`;
    card.addEventListener("click", () => handlers.onSelect(obstacle.id));
    grid.appendChild(card);
  }
  container.append(tabs, hint, actions, grid);
}
