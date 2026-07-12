export async function loadSimulatorData() {
  const [response, catalogResponse, detectionResponse] = await Promise.all([
    fetch("./public/data/simulator-v1-data.json", { cache: "no-store" }),
    fetch("./public/data/battlefield-catalog.json", { cache: "no-store" }),
    fetch("./public/assets/creatures/detection/manifest.json", { cache: "no-store" })
  ]);
  if (!response.ok || !catalogResponse.ok || !detectionResponse.ok) {
    throw new Error(`Could not load simulator data (${response.status}/${catalogResponse.status}/${detectionResponse.status})`);
  }
  const [data, catalog, detection] = await Promise.all([response.json(), catalogResponse.json(), detectionResponse.json()]);
  return { ...data, obstacles: catalog.obstacles, backgrounds: catalog.backgrounds, creatureDetection: detection };
}
