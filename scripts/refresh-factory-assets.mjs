import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createCanvas, GifDisposal, GifEncoder, loadImage } = require("@napi-rs/canvas");

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.dirname(APP_ROOT);
const FACTORY_ROOT = "mods/factory/content";
const WASTELAND_ROOT = "mods/wastelandTerrain/content";
const BATTLE_RELATIVE = `${FACTORY_ROOT}/sprites/hota/factory/creatures/battle`;
const PORTRAIT_RELATIVE = `${FACTORY_ROOT}/sprites/hota/factory/creatures`;
const BACKGROUND_RELATIVE = `${WASTELAND_ROOT}/data/hota/wasteland/battleBackground.png`;
const OBSTACLE_CONFIG_RELATIVE = `${WASTELAND_ROOT}/config/hota/wasteland/obstacles.json`;
const OBSTACLE_SPRITES_RELATIVE = `${WASTELAND_ROOT}/sprites/hota/wasteland/obstacles`;
const SOURCE_LABEL = "VCMI Horn of the Abyss Factory mod 1.1.6";
const SOURCE_COMMIT = "de4db20b7ef3bd6941c2705c3b79f0458d3ba9b9";

const ability = (key, details, kind = "passive") => ({ key, kind, details });
const stats = (attack, defense, minDamage, maxDamage, hp, speed, shots, growth, costGold, costCrystal = 0) => ({
  attack,
  defense,
  minDamage,
  maxDamage,
  hp,
  speed,
  shots,
  growth,
  costGold,
  ...(costCrystal ? { costCrystal } : {})
});

const CREATURES = [
  {
    creatureId: 138, portraitIndex: 1, name: "Halfling", internalName: "halfling", tier: 1, branch: "main", upgrade: 171,
    sourceAsset: "CHalf.def", canonicalDef: "CHALF.def", stats: stats(4, 2, 1, 3, 4, 5, 24, 15, 40), doubleWide: false,
    abilities: [ability("shooter", "Ranged attack; 24 shots."), ability("positiveLuck", "Luck cannot be lower than +1.")]
  },
  {
    creatureId: 171, portraitIndex: 2, name: "Halfling Grenadier", internalName: "halflingGrenadier", tier: 1, branch: "main", upgrade: null,
    sourceAsset: "CHALFB.def", canonicalDef: "CHALFB.def", stats: stats(5, 2, 2, 3, 4, 6, 24, 15, 60), doubleWide: false,
    abilities: [
      ability("shooter", "Ranged attack; 24 shots."),
      ability("enemyDefenceReduction", "Reduces enemy defence by 20%."),
      ability("grenade", "Grenade is applied as a spell-like attack (power 10)."),
      ability("positiveLuck", "Luck cannot be lower than +1.")
    ]
  },
  {
    creatureId: 172, portraitIndex: 3, name: "Mechanic", internalName: "hotaMechanic", tier: 2, branch: "main", upgrade: 173,
    sourceAsset: "CMECHAN.def", canonicalDef: "CMECHAN.def", stats: stats(6, 5, 3, 4, 14, 6, 0, 8, 140), doubleWide: false,
    abilities: [
      ability("twoHexAttackBreath", "Melee attack also strikes the unit directly behind the target."),
      ability("repair", "One adjacent Repair: 10 HP per Mechanic; mechanical targets only; can resurrect and dispel negative effects.", "active")
    ]
  },
  {
    creatureId: 173, portraitIndex: 4, name: "Engineer", internalName: "hotaEngineer", tier: 2, branch: "main", upgrade: null,
    sourceAsset: "CENGINE.def", canonicalDef: "CENGINE.def", stats: stats(7, 5, 3, 5, 16, 7, 0, 8, 170), doubleWide: false,
    abilities: [
      ability("twoHexAttackBreath", "Melee attack also strikes the unit directly behind the target."),
      ability("repair", "One adjacent Repair: 20 HP per Engineer; mechanical targets only; can resurrect and dispel negative effects.", "active")
    ]
  },
  {
    creatureId: 174, portraitIndex: 5, name: "Armadillo", internalName: "armadillo", tier: 3, branch: "main", upgrade: 175,
    sourceAsset: "CARMADL.def", canonicalDef: "CARMADL.def", stats: stats(5, 10, 3, 5, 25, 4, 0, 6, 200), doubleWide: true, abilities: []
  },
  {
    creatureId: 175, portraitIndex: 6, name: "Bellwether Armadillo", internalName: "bellwetherArmadillo", tier: 3, branch: "main", upgrade: null,
    sourceAsset: "CBLWARM.def", canonicalDef: "CBLWARM.def", stats: stats(6, 11, 3, 5, 25, 6, 0, 6, 230), doubleWide: true, abilities: []
  },
  {
    creatureId: 176, portraitIndex: 7, name: "Automaton", internalName: "automaton", tier: 4, branch: "main", upgrade: 177,
    sourceAsset: "CAUTO.def", canonicalDef: "CAUTO.def", stats: stats(12, 10, 7, 7, 30, 8, 0, 5, 350), doubleWide: true,
    abilities: [
      ability("mechanical", "Mechanical creature."),
      ability("ignition", "One self-cast without skipping the turn; the next attack triggers Detonation (range 0-2, power 40, ignores immunity) and disintegrates the stack.", "active")
    ]
  },
  {
    creatureId: 177, portraitIndex: 8, name: "Sentinel Automaton", internalName: "sentinelAutomaton", tier: 4, branch: "main", upgrade: null,
    sourceAsset: "CHAUTO.def", canonicalDef: "CHAUTO.def", stats: stats(12, 10, 9, 9, 30, 9, 0, 5, 450), doubleWide: true,
    abilities: [
      ability("mechanical", "Mechanical creature."),
      ability("blocksRetaliation", "The target cannot retaliate."),
      ability("ignition", "One self-cast without skipping the turn; the next attack triggers Detonation (range 0-2, power 40, ignores immunity) and disintegrates the stack.", "active")
    ]
  },
  {
    creatureId: 178, portraitIndex: 9, name: "Sandworm", internalName: "sandworm", tier: 5, branch: "main", upgrade: 179,
    sourceAsset: "CSANDWX.json", canonicalDef: "CSANDW.def", stats: stats(13, 12, 12, 16, 50, 8, 0, 3, 575), doubleWide: true,
    abilities: [
      ability("burrowing", "Teleport-style movement that ignores battlefield obstacles; unavailable on water."),
      ability("blindImmunity", "Immune to Blind."),
      ability("stoneGazeImmunity", "Immune to Stone Gaze.")
    ]
  },
  {
    creatureId: 179, portraitIndex: 10, name: "Olgoi-Khorkhoi", internalName: "olgoiKhorkhoi", tier: 5, branch: "main", upgrade: null,
    sourceAsset: "COLGOIX.json", canonicalDef: "COLGOI.def", stats: stats(15, 12, 12, 16, 60, 10, 0, 3, 650), doubleWide: true,
    abilities: [
      ability("burrowing", "Teleport-style movement that ignores battlefield obstacles; unavailable on water."),
      ability("blindImmunity", "Immune to Blind."),
      ability("stoneGazeImmunity", "Immune to Stone Gaze."),
      ability("devourCorpses", "Up to 50 casts; consumes a corpse to summon temporary Sandworm Larvae.", "active")
    ]
  },
  {
    creatureId: 180, portraitIndex: 11, name: "Gunslinger", internalName: "gunslinger", tier: 6, branch: "main", upgrade: 181,
    sourceAsset: "CGNSLING.def", canonicalDef: "CGNSLING.def", stats: stats(17, 12, 14, 24, 45, 7, 16, 2, 800), doubleWide: false,
    abilities: [
      ability("shooter", "Ranged attack; 16 shots."),
      ability("rangedRetaliation", "Retaliates with a ranged attack."),
      ability("rangedFirstStrike", "Ranged first strike.")
    ]
  },
  {
    creatureId: 181, portraitIndex: 12, name: "Bounty Hunter", internalName: "bountyHunter", tier: 6, branch: "main", upgrade: null,
    sourceAsset: "CBOUNTHT.def", canonicalDef: "CBOUNTHT.def", stats: stats(18, 14, 14, 24, 45, 8, 24, 2, 1100), doubleWide: false,
    abilities: [
      ability("shooter", "Ranged attack; 24 shots."),
      ability("rangedRetaliation", "Retaliates with a ranged attack."),
      ability("unlimitedRetaliations", "Unlimited retaliations."),
      ability("rangedFirstStrike", "Ranged first strike.")
    ]
  },
  {
    creatureId: 182, portraitIndex: 13, name: "Couatl", internalName: "hotaCouatl", tier: 7, branch: "serpentarium", upgrade: 183,
    sourceAsset: "COUATL.def", canonicalDef: "COUATL.def", stats: stats(17, 17, 25, 45, 160, 11, 0, 1, 2000), doubleWide: true,
    abilities: [
      ability("flying", "Flying creature."),
      ability("meditation", "One cast; skips the turn and grants invulnerability plus immunity to negative effects until the next own turn.", "active")
    ]
  },
  {
    creatureId: 183, portraitIndex: 14, name: "Crimson Couatl", internalName: "crimsonCouatl", tier: 7, branch: "serpentarium", upgrade: null,
    sourceAsset: "COUATR.def", canonicalDef: "RCOUATL.def", stats: stats(21, 21, 25, 45, 200, 15, 0, 1, 3500, 1), doubleWide: true,
    abilities: [
      ability("flying", "Flying creature."),
      ability("meditation", "One cast without skipping the turn; grants invulnerability plus immunity to negative effects until the next own turn.", "active")
    ]
  },
  {
    creatureId: 184, portraitIndex: 15, name: "Dreadnought", internalName: "hotaDreadnought", tier: 7, branch: "gantry", upgrade: 185,
    sourceAsset: "CDREAD.json", canonicalDef: "CDREAD.def", stats: stats(18, 20, 40, 50, 200, 6, 0, 1, 2200, 1), doubleWide: true,
    abilities: [
      ability("mechanical", "Mechanical creature."),
      ability("heatStroke", "Up to 99 casts without skipping the turn; speed becomes 0 and retaliation is disabled until the next attack, which hits L, LL, FL, FF, RF, RR and R.", "active")
    ]
  },
  {
    creatureId: 185, portraitIndex: 16, name: "Juggernaut", internalName: "hotaJuggernaut", tier: 7, branch: "gantry", upgrade: null,
    sourceAsset: "CJUGGER.json", canonicalDef: "CJUGGER.def", stats: stats(23, 23, 40, 50, 300, 7, 0, 1, 3500, 2), doubleWide: true,
    abilities: [
      ability("mechanical", "Mechanical creature."),
      ability("heatStroke", "Up to 99 casts without skipping the turn; speed becomes 0 and retaliation is disabled until the next attack, which hits L, LL, FL, FF, RF, RR and R.", "active")
    ]
  }
];

const SUMMON_ONLY_CREATURES = [
  {
    creatureId: 10001,
    name: "Sandworm Larva",
    sourceAsset: "CLARVA.def",
    canonicalDef: "CLARVA.def"
  }
];

const BATTLE_EXPECTATIONS = {
  "CHalf.def": [438151, "a94b3b69f20bf71adebf3140b077840b9c6df752a805bef7ee45e72da13a7ea1"],
  "CHALFB.def": [440944, "11d01ec06347c0f8f6eed4b451c2ecf8d1c8a081dbfc0c777a401f13efc1a014"],
  "CMECHAN.def": [470809, "449752b4afa8641d43654628f1d304c0be4e8147e793bb1536a9b7e845e6de8c"],
  "CENGINE.def": [498831, "8ac963c79523f48688b8f77a04523b9e7f9d3d4afdda82ae1d3aba60df307903"],
  "CARMADL.def": [504426, "ae7956b071639f0285bf1d02fa508b0e157b9aee878df39aba4f8c09dca446f1"],
  "CBLWARM.def": [556058, "1ad031328f8504312c0d88f53eaa7d6b5bdf057985b4737c7b16b66b4574d995"],
  "CAUTO.def": [593324, "028055f1bf9bd26aef4c17a4f44dedc93eed7cf8ef9783d65706429fe5f3aa34"],
  "CHAUTO.def": [603920, "ac91b81b7a64b31efcc838e65bd43f5ac137597afded11117152f6b328eea0b8"],
  "CSANDWX.json": [8940, "b50d6bfa4eb78c4840d0c25e7b71104c5d98d75e26cb6a9b007305b73850a118"],
  "COLGOIX.json": [12317, "024137d6f4115647e14e5b5a4176882a3344c6df2944e50e2c40c384737c3567"],
  "CGNSLING.def": [709656, "2c39028a4ab8b93c695542822166e163b3d98f26a15721d3ffa33083af6c5d95"],
  "CBOUNTHT.def": [727972, "3f83175f399db3f2fb5b14339e7ee88350e6237ec3b5ba57e95f248e5d83eb04"],
  "COUATL.def": [1327384, "f7d9821a41ede914d99087b05ab73af3f9389ea4dcaf077d1ce8ee73a66b6346"],
  "COUATR.def": [1263298, "ca267ba9df0bc437bc1e260a0e9b7816dd2669dc177a830cb54e4961e2204aa5"],
  "CDREAD.json": [19442, "bfa80666ba510ee27a67dae0cb38badcb15b4f9f5ee0b004dfc2a3db3aa3956e"],
  "CJUGGER.json": [19443, "c3082480cecc92303b09e9e4b7c828cebba1af599bc0f86d65fdaf572a09c375"],
  "CLARVA.def": [100518, "79ebc029166392dd1f6032bad6a65064490b9e0d4fb3b72790f7377d6c26ebd3"]
};

const PORTRAIT_EXPECTATIONS = [
  [[4393, "f12de3b1e81af752ea04945cbca584f76829eb7f158c5d71cee8eb0d9a60a6b7"], [7453, "fcccb722e054ed589bdbef3d522b324e85947be7499be92381543e10065aa776"]],
  [[4736, "d254da02612cb9d7a0d659ed3ea39b1bbe7bcb03b720dd194588daf24c9a9d3c"], [7514, "9eca62c4d184378b2234280de1b014c7211f41528a415b7bbb16467b67f80ca9"]],
  [[5187, "747707927423eac316d3bd0a6e11e159ed4f917d0b7116743f72445f8e47342d"], [7722, "4b9ea626a0717796f4956ac73f15ba8399d7c57d2617e6433637c1e276b10e66"]],
  [[1578, "d68bcd3d56fbba41692fd61afe9f4a1ee420ea2aed5b7120ddde1df980e6484b"], [8419, "83de794e31af404fafe1f9cad36984b923a0f65984da3894a4896d62e3a130f5"]],
  [[1609, "9914526027c5bad03a551cc986f857baed49802161972d8d6d15bc0e7d936602"], [8495, "58036a59c2e34406f36a797ad42df18bc86216ea953af6c273b00680d44de826"]],
  [[1745, "5ee3044538f562216caed03afe23a53f561163719b597d18c4e2210dbe75fb2b"], [8696, "ebc3ad3cc71cf9f5dc1155cd0d319f913891f9a33c2d5c6235256c99830c447e"]],
  [[1675, "1852ae3073ca8e23f6e4ae3b66ce20ac8f31481b974956fa1568cd1d11735b93"], [8149, "a8d463c6655f525710705af149672c8b83fa8c093cb1da5da3f6e00d9c71b529"]],
  [[1641, "949fbac2b0cad869faa9e43ddd27beb9b7c24bd75e64b617358f84222ee7055b"], [8020, "2062345c49f34715ce69693d2e7c9b898d20213f7af41e349ea033e47a316905"]],
  [[5433, "c87c0edd47a35d53350fc535ef6273df376c5ac8469deca8bd504accc576cd1f"], [8497, "827943f570a712e0be50f5deb77eb3e623595b75f279723fe28090eaa5e53550"]],
  [[5058, "29e3493b9a0bc342ca203052945804fc3043ae969e5b2d67c8cb371537127a05"], [8015, "aeaddd96c3a4d8769abc294e8e2dd5758eba42ce61443118b4ca1c6bf9bd3988"]],
  [[1663, "46e30b140f1884dcdfd04b72993a6ed48dbe2698e137ee30757e636e1f270bc6"], [8076, "e2cffea6f2a9ff8bd2cf37c9575e1af045e46d930e72ea9115dff312baa7c328"]],
  [[1669, "fb2beec39e33942caf351fd3f8235d9e5770fe28baceb47cd01f61267b7743a1"], [8227, "66c8ac2c2f60facfd45a3d386505629320677c7814c82558ba1e0ae72526847f"]],
  [[2102, "18968471fe3d5863a2cc87327b22807d9b7800bf3b83dec79e4be4071d97bc98"], [9166, "1f00cb2abb4a7b6aa033a206a644f76f0421296a38fcfce589cc28f0e39204f0"]],
  [[1726, "92db2035832bed8ccf5f246f97704b749ffaf34288034ab597fe7996dc872a3d"], [9619, "38d28bfbfd4dfb0a4b37e93653b3d7d7d3c1a77c02936693c3b1b32215339105"]],
  [[1809, "94b1085f94fba66658f7e6842ac71c5c5549fd1b89dc05f86e0c8f3dd54d9f8d"], [7853, "f029271c6bfd8e2d305abc3d53f2d3566c5268f505829b077e933ad585332965"]],
  [[1819, "111572c067a2fa66cb14a2c977e86d0cca9cd152b356614751d92d826f6b8f5e"], [9016, "51d5ae7f662b70604d802e78b422ba58d3b2239bb4875ca9e45461619862a967"]]
];

const OBSTACLE_EXPECTATIONS = [
  "2b4db2a46b828278d7ac846ec948fb500dbf6e2fde1f4432586c59048902b2c5",
  "18b3d0ec45ffa06e2f381eeaeaba8fdc6606329bbb57d0875a753f4c2f5691f9",
  "faecec9bf658160f47dee58b245dd7600486251d85c813864affc50103172d25",
  "45be794277b4302c4e010535edeb300fdfb26459f2022a2beef54645ea4faa1e",
  "17885eb8328d83ade44f4d35a5f2d6696092cccc261f9db412e00b6c6f7c5257",
  "92fa63d6daa728df0d6f95cd7429f494d4e03c8670a66e6aa562e3746d6ff262",
  "04b0394c86ade9c6bc53ec000e770305b4a20b08092b15e19faaf7f59ab1f937",
  "d9d375c201d0f239d1d2b7425726587bf2fc647d46ab21659e0a15459bf667b8",
  "d944cf436451d4a11695f7775ef2afdfe4fadcf74d7daf9b4fccdb30b04624df",
  "9c73d344daeee06fd2762a782662cf95c054a6985094e28b37cc289b254d5dbf",
  "aed2cab566a30ed9e92ca2a18577bcf313d0acf603a2ead63a98f5bf20add486",
  "e979d85d5fc44afd00c038af1b9e6bd3ff246a09c0f5bcd6a6d8f1f54b6d62c2",
  "eb2a3a1b2505b28f0b8892c017eed0b14379a9814b602d6869d908e60bc4ad1d",
  "98bda523d18ffce5a4ba29bf7a70804a435cd7f4ef0b951eead823d901ce5d29",
  "288194f57e894fda68c0b8a9c4a3c768a0ea25145294474ef04d1176e5b1a320"
];
const BACKGROUND_SHA256 = "eb8f034d39766d64348706a4cb2168998577906ab90fc4211778afdca8716c6d";
const DEF_SPECIAL_COLORS = new Set([
  "0,255,255",
  "255,150,255",
  "255,100,255",
  "255,50,255",
  "255,0,255",
  "255,255,0",
  "180,0,255",
  "0,255,0"
]);

const ANIMATION_GROUPS = {
  move: { groupId: 0, durationMs: 90, loop: true, reverse: true },
  idle: { groupId: 2, durationMs: 140, loop: true, reverse: false },
  hit: { groupId: 3, durationMs: 90, loop: false, reverse: false },
  defend: { groupId: 4, durationMs: 90, loop: false, reverse: false },
  death: { groupId: 5, durationMs: 110, loop: false, reverse: false },
  "attack-up": { groupId: 10, durationMs: 80, loop: false, reverse: false },
  "attack-front": { groupId: 11, durationMs: 80, loop: false, reverse: false },
  "attack-down": { groupId: 12, durationMs: 80, loop: false, reverse: false },
  "shoot-up": { groupId: 13, durationMs: 80, loop: false, reverse: false },
  "shoot-front": { groupId: 14, durationMs: 80, loop: false, reverse: false },
  "shoot-down": { groupId: 15, durationMs: 80, loop: false, reverse: false }
};

function parseArgs(argv) {
  let vcmiRoot = null;
  let allowUnverified = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--vcmi-root") vcmiRoot = argv[++index];
    else if (argument === "--allow-unverified") allowUnverified = true;
    else if (argument === "--help" || argument === "-h") {
      console.log("Usage: node scripts/refresh-factory-assets.mjs [--vcmi-root PATH] [--allow-unverified]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return { vcmiRoot, allowUnverified };
}

async function isFile(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function resolveVcmiRoot(explicitRoot) {
  const candidates = explicitRoot
    ? [path.resolve(explicitRoot)]
    : [path.join(WORKSPACE_ROOT, ".tmp", "hota-vcmi-audit"), path.join(WORKSPACE_ROOT, ".tmp", "hota-vcmi")];
  for (const candidate of candidates) {
    if (await isFile(path.join(candidate, BATTLE_RELATIVE, "CHalf.def")) && await isFile(path.join(candidate, BACKGROUND_RELATIVE))) return candidate;
  }
  throw new Error(`Could not find Factory and Wasteland source assets; searched: ${candidates.join(", ")}`);
}

async function sha256(filename) {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

async function verifyFile(filename, expectedSize, expectedHash, mismatches) {
  if (!await isFile(filename)) throw new Error(`Missing audited HotA asset: ${filename}`);
  const actualSize = (await stat(filename)).size;
  const actualHash = await sha256(filename);
  if ((expectedSize != null && actualSize !== expectedSize) || actualHash !== expectedHash) {
    mismatches.push(`${filename}: size=${actualSize}, sha256=${actualHash}`);
  }
}

function obstacleSource(vcmiRoot, index) {
  const name = `ObWLD${String(index).padStart(2, "0")}`;
  return path.join(vcmiRoot, OBSTACLE_SPRITES_RELATIVE, name, `${name}.png`);
}

async function validateSources(vcmiRoot, allowUnverified) {
  const mismatches = [];
  const battleRoot = path.join(vcmiRoot, BATTLE_RELATIVE);
  const portraitRoot = path.join(vcmiRoot, PORTRAIT_RELATIVE);
  for (const [filename, [size, hash]] of Object.entries(BATTLE_EXPECTATIONS)) {
    await verifyFile(path.join(battleRoot, filename), size, hash, mismatches);
  }
  for (let index = 1; index <= PORTRAIT_EXPECTATIONS.length; index += 1) {
    const [[smallSize, smallHash], [largeSize, largeHash]] = PORTRAIT_EXPECTATIONS[index - 1];
    const suffix = `${String(index).padStart(3, "0")}F.png`;
    await verifyFile(path.join(portraitRoot, "iconsSmall", `CPrS${suffix}`), smallSize, smallHash, mismatches);
    await verifyFile(path.join(portraitRoot, "iconsLarge", `CPrL${suffix}`), largeSize, largeHash, mismatches);
  }
  await verifyFile(path.join(vcmiRoot, BACKGROUND_RELATIVE), 993194, BACKGROUND_SHA256, mismatches);
  for (let index = 0; index < OBSTACLE_EXPECTATIONS.length; index += 1) {
    await verifyFile(obstacleSource(vcmiRoot, index), null, OBSTACLE_EXPECTATIONS[index], mismatches);
  }
  if (mismatches.length && !allowUnverified) {
    throw new Error(`Factory assets differ from the audited VCMI revision:\n  ${mismatches.join("\n  ")}`);
  }
}

function decodeDefFrame(buffer, frameOffset, palette, groupIndex, groupId, frameIndex) {
  if (frameOffset + 32 > buffer.length) return null;
  const size = buffer.readUInt32LE(frameOffset);
  const format = buffer.readUInt32LE(frameOffset + 4);
  const fullWidth = buffer.readUInt32LE(frameOffset + 8);
  const fullHeight = buffer.readUInt32LE(frameOffset + 12);
  const width = buffer.readUInt32LE(frameOffset + 16);
  const height = buffer.readUInt32LE(frameOffset + 20);
  const left = buffer.readUInt32LE(frameOffset + 24);
  const top = buffer.readUInt32LE(frameOffset + 28);
  if (!width || !height || width > 2048 || height > 2048) return null;
  const indexes = new Uint8Array(width * height);
  const body = frameOffset + 32;
  if (format === 0) {
    if (body + indexes.length > buffer.length) return null;
    indexes.set(buffer.subarray(body, body + indexes.length));
  } else if (format === 1) {
    if (body + height * 4 > buffer.length) return null;
    const rowOffsets = Array.from({ length: height }, (_, row) => buffer.readUInt32LE(body + row * 4));
    for (let y = 0; y < height; y += 1) {
      let cursor = body + rowOffsets[y];
      const rowEnd = y + 1 < height ? body + rowOffsets[y + 1] : frameOffset + size;
      if (cursor < body || cursor >= buffer.length || rowEnd > buffer.length) return null;
      let x = 0;
      while (cursor + 1 < rowEnd && x < width) {
        const operation = buffer[cursor];
        const runLength = buffer[cursor + 1] + 1;
        cursor += 2;
        if (operation === 0) {
          x += runLength;
        } else if (operation === 255) {
          if (cursor + runLength > buffer.length) return null;
          for (let run = 0; run < runLength && x < width; run += 1) indexes[y * width + x++] = buffer[cursor + run];
          cursor += runLength;
        } else {
          for (let run = 0; run < runLength && x < width; run += 1) indexes[y * width + x++] = operation;
        }
      }
    }
  } else return null;

  const data = new Uint8ClampedArray(fullWidth * fullHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destinationX = left + x;
      const destinationY = top + y;
      if (destinationX >= fullWidth || destinationY >= fullHeight) continue;
      const [red, green, blue, alpha] = palette[indexes[y * width + x]];
      const destination = (destinationY * fullWidth + destinationX) * 4;
      data[destination] = red;
      data[destination + 1] = green;
      data[destination + 2] = blue;
      data[destination + 3] = alpha;
    }
  }
  return { width: fullWidth, height: fullHeight, data, groupIndex, groupId, frameIndex };
}

function decodeDef(buffer) {
  if (buffer.length < 784) throw new Error("DEF is too small");
  const canvasWidth = buffer.readUInt32LE(4);
  const canvasHeight = buffer.readUInt32LE(8);
  const groupCount = buffer.readUInt32LE(12);
  const palette = Array.from({ length: 256 }, (_, index) => [
    buffer[16 + index * 3],
    buffer[17 + index * 3],
    buffer[18 + index * 3],
    index < 8 ? 0 : 255
  ]);
  const frames = [];
  let offset = 16 + 768;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    if (offset + 16 > buffer.length) throw new Error(`Truncated DEF group ${groupIndex}`);
    const groupId = buffer.readUInt32LE(offset);
    const frameCount = buffer.readUInt32LE(offset + 4);
    offset += 16 + frameCount * 13;
    if (offset + frameCount * 4 > buffer.length) throw new Error(`Truncated DEF frame table ${groupIndex}`);
    const frameOffsets = Array.from({ length: frameCount }, (_, frameIndex) => buffer.readUInt32LE(offset + frameIndex * 4));
    offset += frameCount * 4;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frame = decodeDefFrame(buffer, frameOffsets[frameIndex], palette, groupIndex, groupId, frameIndex);
      if (!frame) {
        const format = frameOffsets[frameIndex] + 8 <= buffer.length ? buffer.readUInt32LE(frameOffsets[frameIndex] + 4) : "unknown";
        throw new Error(`Could not decode DEF group=${groupId} frame=${frameIndex} format=${format}`);
      }
      frames.push(frame);
    }
  }
  return { frames, meta: { canvasWidth, canvasHeight, groupCount, decodedFrameCount: frames.length, sourceFormat: "def" } };
}

async function rgbaFromPng(filename) {
  const image = await loadImage(filename);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(context.getImageData(0, 0, image.width, image.height).data) };
}

function removeDefSpecialColors(frame) {
  const data = new Uint8ClampedArray(frame.data);
  for (let index = 0; index < data.length; index += 4) {
    if (DEF_SPECIAL_COLORS.has(`${data[index]},${data[index + 1]},${data[index + 2]}`)) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
    }
  }
  return { ...frame, data };
}

async function loadJsonFrames(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const imageRoot = path.join(path.dirname(manifestPath), path.basename(manifestPath, path.extname(manifestPath)));
  const groupIds = [...new Set(manifest.images.map(entry => Number(entry.group)))].sort((left, right) => left - right);
  const groupIndexes = new Map(groupIds.map((groupId, index) => [groupId, index]));
  const seen = new Set();
  const frames = [];
  for (const entry of manifest.images) {
    const groupId = Number(entry.group);
    const frameIndex = Number(entry.frame);
    const key = `${groupId}:${frameIndex}`;
    if (seen.has(key)) throw new Error(`Duplicate JSON group/frame in ${manifestPath}: ${key}`);
    seen.add(key);
    const source = path.join(imageRoot, entry.file);
    if (!await isFile(source)) throw new Error(`Missing JSON animation frame: ${source}`);
    const frame = removeDefSpecialColors(await rgbaFromPng(source));
    if (frame.width !== 450 || frame.height !== 400) throw new Error(`Unexpected JSON animation canvas in ${source}: ${frame.width}x${frame.height}`);
    frames.push({ ...frame, groupIndex: groupIndexes.get(groupId), groupId, frameIndex });
  }
  return { frames, meta: { canvasWidth: 450, canvasHeight: 400, groupCount: groupIds.length, decodedFrameCount: frames.length, sourceFormat: "vcmi-json-png" } };
}

async function loadCreatureFrames(source) {
  if (path.extname(source).toLowerCase() === ".json") return loadJsonFrames(source);
  return decodeDef(await readFile(source));
}

function boundingBox(frame) {
  let left = frame.width;
  let top = frame.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (frame.data[(y * frame.width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + 1 > right) right = x + 1;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function cropFrame(frame, box) {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((box.top + y) * frame.width + box.left) * 4;
    data.set(frame.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
  }
  return { ...frame, width, height, data };
}

function sharedCrop(frames, padding = 4) {
  const boxes = frames.map(boundingBox).filter(Boolean);
  if (!boxes.length) return frames;
  const box = {
    left: Math.max(0, Math.min(...boxes.map(value => value.left)) - padding),
    top: Math.max(0, Math.min(...boxes.map(value => value.top)) - padding),
    right: Math.min(frames[0].width, Math.max(...boxes.map(value => value.right)) + padding),
    bottom: Math.min(frames[0].height, Math.max(...boxes.map(value => value.bottom)) + padding)
  };
  return frames.map(frame => cropFrame(frame, box));
}

function tightCrop(frame, padding = 2) {
  const raw = boundingBox(frame);
  if (!raw) return frame;
  return cropFrame(frame, {
    left: Math.max(0, raw.left - padding),
    top: Math.max(0, raw.top - padding),
    right: Math.min(frame.width, raw.right + padding),
    bottom: Math.min(frame.height, raw.bottom + padding)
  });
}

function canvasFromFrame(frame) {
  const canvas = createCanvas(frame.width, frame.height);
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(frame.width, frame.height);
  imageData.data.set(frame.data);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function writePng(frame, destination) {
  await writeFile(destination, canvasFromFrame(frame).encodeSync("png"));
}

async function writeGif(frames, destination, durationMs, loop) {
  const encoder = new GifEncoder(frames[0].width, frames[0].height, { repeat: loop ? 0 : 1, quality: 10 });
  for (const frame of frames) {
    const rgba = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    encoder.addFrame(rgba, frame.width, frame.height, { delay: durationMs, disposal: GifDisposal.Background });
  }
  await writeFile(destination, encoder.finish());
}

async function writeSpritesheet(frames, destination) {
  const columns = Math.min(8, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const width = Math.max(...frames.map(frame => frame.width));
  const height = Math.max(...frames.map(frame => frame.height));
  const canvas = createCanvas(columns * width, rows * height);
  const context = canvas.getContext("2d");
  frames.forEach((frame, index) => {
    context.drawImage(canvasFromFrame(frame), (index % columns) * width, Math.floor(index / columns) * height);
  });
  await writeFile(destination, canvas.encodeSync("png"));
}

async function removeGeneratedFiles(directory, patterns) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (patterns.some(pattern => pattern.test(entry.name))) await unlink(path.join(directory, entry.name));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function exportCreature(spec, sourcePath, portraitRoot, { includeDetection = true } = {}) {
  const { frames, meta } = await loadCreatureFrames(sourcePath);
  const sourceFormat = meta.sourceFormat;
  const byGroup = new Map();
  for (const frame of frames) {
    if (!byGroup.has(frame.groupId)) byGroup.set(frame.groupId, []);
    byGroup.get(frame.groupId).push(frame);
  }
  for (const group of byGroup.values()) group.sort((left, right) => left.frameIndex - right.frameIndex);

  const creatureId = spec.creatureId;
  const animationRoot = path.join(APP_ROOT, "public", "assets", "creatures", "animations", String(creatureId));
  const previewRoot = path.join(APP_ROOT, "public", "assets", "creatures", "png");
  const spritesheetRoot = path.join(APP_ROOT, "public", "assets", "creatures", "spritesheets");
  const detectionRoot = includeDetection
    ? path.join(APP_ROOT, "public", "assets", "creatures", "detection", String(creatureId))
    : null;
  const outputRoots = [animationRoot, previewRoot, spritesheetRoot, ...(detectionRoot ? [detectionRoot] : [])];
  await Promise.all(outputRoots.map(directory => mkdir(directory, { recursive: true })));
  await removeGeneratedFiles(animationRoot, [/\.gif$/i, /^corpse\.png$/i]);
  if (detectionRoot) await removeGeneratedFiles(detectionRoot, [/^frame-\d+\.png$/i, /^idle-\d+\.png$/i]);

  const extracted = {};
  const actions = [];
  for (const [name, definition] of Object.entries(ANIMATION_GROUPS)) {
    let sourceFrames = [...(byGroup.get(definition.groupId) || [])];
    if (!sourceFrames.length) continue;
    if (definition.reverse) sourceFrames.reverse();
    const images = sharedCrop(sourceFrames.map(frame => ({ ...frame, data: new Uint8ClampedArray(frame.data) })));
    await writeGif(images, path.join(animationRoot, `${name}.gif`), definition.durationMs, definition.loop);
    actions.push(name);
    extracted[name] = {
      groupId: definition.groupId,
      groupIndex: sourceFrames[0].groupIndex,
      frameCount: images.length,
      durationMs: definition.durationMs
    };
    if (name === "idle") await writePng(images[0], path.join(previewRoot, `${creatureId}.png`));
    if (name === "death") {
      await writePng(tightCrop(images.at(-1)), path.join(animationRoot, "corpse.png"));
      extracted.corpse = { source: "tight-cropped last rendered death frame, centered by the simulator" };
    }
  }
  const required = ["move", "idle", "hit", "defend", "death", "attack-front"];
  const missing = required.filter(name => !actions.includes(name));
  if (missing.length) throw new Error(`${sourcePath} is missing required animation groups: ${missing.join(", ")}`);
  await writeSpritesheet(sharedCrop((byGroup.get(0) || []).map(frame => ({ ...frame, data: new Uint8ClampedArray(frame.data) }))), path.join(spritesheetRoot, `${creatureId}.png`));

  const sourceHash = await sha256(sourcePath);
  const animationEntry = {
    def: spec.canonicalDef,
    sourceAsset: spec.sourceAsset,
    sourceFormat,
    archive: SOURCE_LABEL,
    sourceSha256: sourceHash,
    animations: extracted
  };
  let detectionEntry = null;
  if (includeDetection) {
    const portraitSuffix = `${String(spec.portraitIndex).padStart(3, "0")}F.png`;
    const portraitSource = path.join(portraitRoot, "iconsSmall", `CPrS${portraitSuffix}`);
    const queueSource = path.join(portraitRoot, "iconsLarge", `CPrL${portraitSuffix}`);
    const portraitDestination = path.join(detectionRoot, "portrait.png");
    const queueDestination = path.join(detectionRoot, "queue-portrait.png");
    await copyFile(portraitSource, portraitDestination);
    await copyFile(queueSource, queueDestination);
    const portrait = await loadImage(portraitDestination);
    const queuePortrait = await loadImage(queueDestination);
    if (portrait.width !== 32 || portrait.height !== 32) throw new Error(`Unexpected portrait dimensions: ${portraitDestination}`);
    if (queuePortrait.width !== 58 || queuePortrait.height !== 64) throw new Error(`Unexpected queue portrait dimensions: ${queueDestination}`);

    const detectionFrames = frames
      .filter(frame => [0, 1, 2].includes(frame.groupId))
      .sort((left, right) => left.groupId - right.groupId || left.frameIndex - right.frameIndex);
    const exportedDetection = [];
    for (let index = 0; index < detectionFrames.length; index += 1) {
      const frame = detectionFrames[index];
      const box = boundingBox(frame);
      if (!box) throw new Error(`Transparent detection frame in ${sourcePath}: group=${frame.groupId}, frame=${frame.frameIndex}`);
      const cropped = cropFrame(frame, box);
      const filename = `frame-${index}.png`;
      await writePng(cropped, path.join(detectionRoot, filename));
      exportedDetection.push({
        image: `assets/creatures/detection/${creatureId}/${filename}`,
        left: box.left,
        top: box.top,
        width: cropped.width,
        height: cropped.height,
        canvasWidth: frame.width,
        canvasHeight: frame.height,
        groupIndex: frame.groupIndex,
        groupId: frame.groupId,
        frameIndex: frame.frameIndex
      });
    }
    detectionEntry = {
      def: spec.canonicalDef,
      sourceAsset: spec.sourceAsset,
      sourceFormat,
      sourceSha256: sourceHash,
      portrait: `assets/creatures/detection/${creatureId}/portrait.png`,
      queuePortrait: `assets/creatures/detection/${creatureId}/queue-portrait.png`,
      frames: exportedDetection
    };
  }
  const asset = {
    displayImage: `assets/creatures/png/${creatureId}.png`,
    idleAnimation: `assets/creatures/animations/${creatureId}/idle.gif`,
    previewImage: `assets/creatures/png/${creatureId}.png`,
    spritesheet: `assets/creatures/spritesheets/${creatureId}.png`,
    corpseImage: `assets/creatures/animations/${creatureId}/corpse.png`,
    battleAnimationRoot: `assets/creatures/animations/${creatureId}`,
    battleAnimationActions: [...actions, "corpse"],
    ...(includeDetection ? {
      portrait: `assets/creatures/detection/${creatureId}/portrait.png`,
      queuePortrait: `assets/creatures/detection/${creatureId}/queue-portrait.png`
    } : {}),
    assetStatus: "EXTRACTED",
    sourceArchive: SOURCE_LABEL,
    sourceAsset: spec.sourceAsset,
    sourceSha256: sourceHash,
    fallbackReason: null
  };
  return { animationEntry, detectionEntry, asset };
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadJsonWithComments(text) {
  return JSON.parse(text.replace(/\/\/.*$/gm, ""));
}

function resizedFingerprint(frame, sourceRect, width, height) {
  const sourceCanvas = canvasFromFrame(frame);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.drawImage(sourceCanvas, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const values = [];
  for (let index = 0; index < data.length; index += 4) values.push(data[index], data[index + 1], data[index + 2]);
  return values;
}

async function exportWasteland(vcmiRoot) {
  const backgroundSource = path.join(vcmiRoot, BACKGROUND_RELATIVE);
  const backgroundDestination = path.join(APP_ROOT, "public", "assets", "battlefields", "backgrounds", "wasteland_rocks.png");
  await mkdir(path.dirname(backgroundDestination), { recursive: true });
  await copyFile(backgroundSource, backgroundDestination);
  const background = await rgbaFromPng(backgroundDestination);
  if (background.width !== 800 || background.height !== 556) throw new Error(`Unexpected Wasteland background dimensions: ${background.width}x${background.height}`);

  const definitions = loadJsonWithComments(await readFile(path.join(vcmiRoot, OBSTACLE_CONFIG_RELATIVE), "utf8"));
  const catalogPath = path.join(APP_ROOT, "public", "data", "battlefield-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const reservedIds = new Set(Array.from({ length: 15 }, (_, index) => 200 + index));
  const records = catalog.obstacles.filter(record => !reservedIds.has(record.id) && !String(record.name || "").startsWith("ObWLD"));
  const obstacleDestinationRoot = path.join(APP_ROOT, "public", "assets", "battlefields", "obstacles");
  await mkdir(obstacleDestinationRoot, { recursive: true });
  for (let index = 0; index < 15; index += 1) {
    const sourceId = `hotaWLD${String(index).padStart(2, "0")}`;
    const name = `ObWLD${String(index).padStart(2, "0")}`;
    const definition = definitions[sourceId];
    const source = obstacleSource(vcmiRoot, index);
    const outputId = 200 + index;
    const destination = path.join(obstacleDestinationRoot, `obstacle-${outputId}.png`);
    await copyFile(source, destination);
    const image = await loadImage(destination);
    const absolute = Boolean(definition.absolute);
    const record = {
      id: outputId,
      sourceId,
      name,
      sourceName: `${name}.png`,
      sourceSha256: await sha256(source),
      category: "wasteland",
      allowedTerrains: definition.allowedTerrains || [],
      specialBattlefields: definition.specialBattlefields || [],
      width: definition.width,
      height: definition.height,
      blockedTiles: definition.blockedTiles,
      absolute,
      foreground: Boolean(definition.foreground),
      placementSemantics: absolute ? "absolute-graphic-offset" : "regular-free-tile-extents",
      image: `assets/battlefields/obstacles/obstacle-${outputId}.png`,
      imageWidth: image.width,
      imageHeight: image.height,
      ...(absolute ? { placementOffsetX: definition.width, placementOffsetY: definition.height } : {})
    };
    records.push(record);
  }
  records.sort((left, right) => left.id - right.id);
  const backgrounds = catalog.backgrounds.filter(entry => entry.id !== "wasteland_rocks");
  backgrounds.push({
    id: "wasteland_rocks",
    name: "wasteland",
    type: "terrain",
    town: "Factory",
    image: "assets/battlefields/backgrounds/wasteland_rocks.png",
    sourceSha256: BACKGROUND_SHA256,
    width: background.width,
    height: background.height,
    fingerprint: resizedFingerprint(background, { x: 0, y: 0, width: 800, height: 556 }, 16, 11),
    horizonFingerprint: resizedFingerprint(background, { x: 96, y: 0, width: 704, height: 104 }, 64, 8)
  });
  const addition = "VCMI HotA Factory/Wasteland assets";
  if (!String(catalog.source || "").includes(addition)) catalog.source = `${catalog.source || ""} + ${addition}`.replace(/^ \+ /, "");
  catalog.obstacleCount = records.length;
  catalog.obstacles = records;
  catalog.backgrounds = backgrounds;
  await writeJson(catalogPath, catalog);
}

async function writeFactoryData(creatures) {
  const lines = [
    { tier: 1, branch: "main", base: 138, upgrade: 171 },
    { tier: 2, branch: "main", base: 172, upgrade: 173 },
    { tier: 3, branch: "main", base: 174, upgrade: 175 },
    { tier: 4, branch: "main", base: 176, upgrade: 177 },
    { tier: 5, branch: "main", base: 178, upgrade: 179 },
    { tier: 6, branch: "main", base: 180, upgrade: 181 },
    { tier: 7, branch: "serpentarium", base: 182, upgrade: 183 },
    { tier: 7, branch: "gantry", base: 184, upgrade: 185 }
  ];
  await writeJson(path.join(APP_ROOT, "public", "data", "factory-creatures.json"), {
    schemaVersion: 1,
    source: SOURCE_LABEL,
    sourceCommit: SOURCE_COMMIT,
    town: { townType: 11, name: "Factory", nativeTerrain: "wasteland", battlefield: "wasteland_rocks", creatureLines: lines },
    creatures
  });
}

export async function refreshFactoryAssets(argv = []) {
  const args = parseArgs(argv);
  const vcmiRoot = await resolveVcmiRoot(args.vcmiRoot);
  await validateSources(vcmiRoot, args.allowUnverified);
  const battleRoot = path.join(vcmiRoot, BATTLE_RELATIVE);
  const portraitRoot = path.join(vcmiRoot, PORTRAIT_RELATIVE);
  const animationManifestPath = path.join(APP_ROOT, "public", "assets", "creatures", "animations", "castle-battle-animations.json");
  const detectionManifestPath = path.join(APP_ROOT, "public", "assets", "creatures", "detection", "manifest.json");
  const animationManifest = JSON.parse(await readFile(animationManifestPath, "utf8"));
  const detectionManifest = JSON.parse(await readFile(detectionManifestPath, "utf8"));
  animationManifest.source = "Heroes III and Horn of the Abyss creature animation groups";
  animationManifest.summonOnlyCreatures ||= {};

  const exportedCreatures = [];
  let animationAssetCount = 0;
  let detectionFrameCount = 0;
  for (const sourceSpec of CREATURES) {
    const spec = structuredClone(sourceSpec);
    const sourcePath = path.join(battleRoot, spec.sourceAsset);
    const { animationEntry, detectionEntry, asset } = await exportCreature(spec, sourcePath, portraitRoot);
    animationManifest.creatures[String(spec.creatureId)] = animationEntry;
    detectionManifest.creatures[String(spec.creatureId)] = detectionEntry;
    const { portraitIndex, ...publicSpec } = spec;
    exportedCreatures.push({ ...publicSpec, faction: "Factory", status: "CONFIRMED_VCMI_HOTA_FACTORY_1_1_6", asset });
    animationAssetCount += asset.battleAnimationActions.length;
    detectionFrameCount += detectionEntry.frames.length;
    console.log(`Factory ${spec.creatureId} ${spec.name}: ${asset.battleAnimationActions.length} animation assets, ${detectionEntry.frames.length} detection frames`);
  }
  for (const sourceSpec of SUMMON_ONLY_CREATURES) {
    const spec = structuredClone(sourceSpec);
    const sourcePath = path.join(battleRoot, spec.sourceAsset);
    const { animationEntry, asset } = await exportCreature(spec, sourcePath, null, { includeDetection: false });
    delete animationManifest.creatures[String(spec.creatureId)];
    delete detectionManifest.creatures[String(spec.creatureId)];
    animationManifest.summonOnlyCreatures[String(spec.creatureId)] = { ...animationEntry, summonOnly: true };
    console.log(`Factory summon-only ${spec.creatureId} ${spec.name}: ${asset.battleAnimationActions.length} animation assets, no detection frames`);
  }
  await writeJson(animationManifestPath, animationManifest);
  await writeJson(detectionManifestPath, detectionManifest);
  await writeFactoryData(exportedCreatures);
  await exportWasteland(vcmiRoot);
  console.log(`Refreshed Factory assets from ${vcmiRoot}`);
  console.log(`Exported 16 recruitable creatures plus ${SUMMON_ONLY_CREATURES.length} summon-only visual, ${animationAssetCount} recruitable animation assets, ${detectionFrameCount} detection frames, 15 obstacles and 1 background.`);
}

const invokedFromCli = typeof process !== "undefined"
  && Array.isArray(process.argv)
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedFromCli) {
  refreshFactoryAssets(process.argv.slice(2)).catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
