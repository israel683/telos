// GENERATED FILE — do not edit by hand.
// Source of truth: growk/cultivars/*.json
// Regenerate with: npm run sync:cultivars
import type { CultivarRecord } from "./cultivars";

export const CULTIVAR_REGISTRY: Record<string, CultivarRecord> = {
  "basil": {
    "id": "basil",
    "species": "basil",
    "cultivar": null,
    "provenance": null,
    "protocol_version": 1,
    "inherits": null,
    "stages": {
      "seedling": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "vegetative": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1900,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1700,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1700,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "Lower-leaf yellowing under sustained low EC — vegetative basil is a heavy feeder.",
      "Flower spikes forming — pinch to hold the plant in leaf; flowering shifts flavour."
    ],
    "harvest_markers": [
      "First pinch once 3-4 true-leaf pairs are set; harvest above a node to drive bushing."
    ],
    "story": {
      "he": null,
      "en": null
    }
  },
  "basilico-genovese-dop": {
    "id": "basilico-genovese-dop",
    "species": "basil",
    "cultivar": "Basilico Genovese DOP",
    "provenance": "Liguria, Italy",
    "protocol_version": 1,
    "inherits": "basil",
    "stages": {
      "seedling": {
        "ec": {
          "target": 900,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 21,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "vegetative": {
        "ph": {
          "target": 5.9,
          "tolerance": 0.3,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1600,
          "tolerance": 12,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "ec": {
          "target": 1500,
          "tolerance": 12,
          "tolerance_mode": "percent"
        }
      }
    },
    "stress_signatures": [
      "Aroma falls off when water holds above 25C — the volatile oils that define Genovese degrade in heat. Hold temperature before chasing EC.",
      "Leaf coarsens and serrates under high EC; true Genovese leaf is broad, cupped, and tender. Tip burn means the band was crossed.",
      "Early flower spikes blunt the flavour — pinch the moment they appear."
    ],
    "harvest_markers": [
      "Ready when the canopy carries large, cupped, deep-green leaves with the sweet anise nose and no purple stem flush.",
      "Cut above a leaf node to drive a second flush; never strip a plant bare."
    ],
    "story": {
      "he": "בזיליקו ג'נובזה DOP — הבזיליקון המוגן של ליגוריה, עלה רחב ומתוק, הבסיס האמיתי לפסטו ג'נובזה.",
      "en": "Basilico Genovese DOP — the protected basil of Liguria: a broad, sweet, cupped leaf with a soft anise nose. The only basil a Ligurian pesto is built on, and a name a chef asks for."
    }
  },
  "lettuce": {
    "id": "lettuce",
    "species": "lettuce",
    "cultivar": null,
    "provenance": null,
    "protocol_version": 1,
    "inherits": null,
    "stages": {
      "seedling": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 800,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 20,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "vegetative": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 21,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1100,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 21,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "ph": {
          "target": 6,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1100,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 21,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "Tip burn on new leaves — EC too high or calcium uptake suppressed by heat.",
      "Bolting (early flower stalk) when water rises above band in summer — bitter leaf."
    ],
    "harvest_markers": [
      "Cut whole head once the rosette is full and firm, before any stalk elongates."
    ],
    "story": {
      "he": null,
      "en": null
    }
  }
};
