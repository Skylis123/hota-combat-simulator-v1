export async function loadSimulatorData() {
  const response = await fetch("./public/data/simulator-v1-data.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load simulator-v1-data.json (${response.status})`);
  }
  return response.json();
}
