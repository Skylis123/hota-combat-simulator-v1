export function renderBackgroundMenu(container, data, state, onSelect) {
  container.innerHTML = "";
  const groups = new Map();
  for (const background of data.backgrounds) {
    const group = groups.get(background.type) || [];
    group.push(background);
    groups.set(background.type, group);
  }
  for (const [type, backgrounds] of groups) {
    const heading = document.createElement("div");
    heading.className = "background-group-title";
    heading.textContent = type;
    const grid = document.createElement("div");
    grid.className = "background-cards";
    for (const background of backgrounds) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `background-card ${state.backgroundId === background.id ? "selected" : ""}`;
      card.innerHTML = `<img src="./public/${background.image}" alt="" /><span>${background.name}</span>`;
      card.addEventListener("click", () => onSelect(background.id));
      grid.appendChild(card);
    }
    container.append(heading, grid);
  }
}
