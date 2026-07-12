export async function loadSimulatorData() {
  const [response, catalogResponse] = await Promise.all([
    fetch("./public/data/simulator-v1-data.json", { cache: "no-store" }),
    fetch("./public/data/battlefield-catalog.json", { cache: "no-store" })
  ]);
  if (!response.ok || !catalogResponse.ok) {
    throw new Error(`Could not load simulator data (${response.status}/${catalogResponse.status})`);
  }
  const [data, catalog] = await Promise.all([response.json(), catalogResponse.json()]);
  return { ...data, obstacles: catalog.obstacles, backgrounds: catalog.backgrounds };
}
