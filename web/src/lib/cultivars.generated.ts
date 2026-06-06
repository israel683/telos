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
    "harvest": {
      "mode": "cut_and_come_again",
      "first_harvest": "Once 3-4 true-leaf pairs are set and the plant is ~15-20 cm tall.",
      "cadence_days": 9,
      "instructions": "Cut each stem just above a leaf node, taking the top ~third down to a strong leaf pair; never strip below ~4 leaves. Remove any flower buds in the same pass. Cutting above a node drives two new shoots — harvest IS pruning, and frequent cutting holds the plant in leaf and suppresses bolting.",
      "end_of_grow": "Productive for months under steady pinching; retire/replace when stems turn woody or it bolts persistently in heat despite pinching."
    },
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
    "harvest": {
      "mode": "cut_and_come_again",
      "first_harvest": "When the canopy carries large, cupped, deep-green leaves with a sweet anise nose and no flower spikes — usually ~3-4 leaf-pairs in.",
      "cadence_days": 8,
      "instructions": "Harvest in the cool morning, when the volatile oils peak. Cut each stem just above a leaf node, taking the top third; leave at least two strong leaf pairs — never strip a plant bare. Pinch out every flower bud in the same pass — flowering blunts the Genovese aroma. Each cut above a node drives a second flush.",
      "end_of_grow": "Open-ended under disciplined pinching; replace when the leaf coarsens/serrates or it bolts repeatedly despite cool-morning harvest and afternoon shade."
    },
    "story": {
      "he": "בזיליקו ג'נובזה DOP — הבזיליקון המוגן של ליגוריה, עלה רחב ומתוק, הבסיס האמיתי לפסטו ג'נובזה.",
      "en": "Basilico Genovese DOP — the protected basil of Liguria: a broad, sweet, cupped leaf with a soft anise nose. The only basil a Ligurian pesto is built on, and a name a chef asks for."
    }
  },
  "chicory": {
    "id": "chicory",
    "species": "chicory",
    "cultivar": null,
    "provenance": null,
    "protocol_version": 1,
    "inherits": null,
    "stages": {
      "seedling": {
        "ph": {
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 18,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "vegetative": {
        "ph": {
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1500,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 18,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "ph": {
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1600,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 17,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "ph": {
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1600,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 17,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "Bitterness turns harsh and leaf stays all-green when the finish is too warm — chicories need a cool turn to colour and sweeten.",
      "Tip burn on the tight head signals EC ran high through heading."
    ],
    "harvest_markers": [
      "Ready when the head is firm and the red/white contrast is full; a cool finish sets both colour and the clean bitter edge."
    ],
    "story": {
      "he": null,
      "en": null
    }
  },
  "corn_salad": {
    "id": "corn_salad",
    "species": "corn_salad",
    "cultivar": null,
    "provenance": null,
    "protocol_version": 1,
    "inherits": null,
    "stages": {
      "seedling": {
        "ph": {
          "target": 6.5,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 800,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 16,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "vegetative": {
        "ph": {
          "target": 6.5,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 16,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "ph": {
          "target": 6.5,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 15,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "ph": {
          "target": 6.5,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 1000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 15,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "A cold-lover: above the band it bolts fast and the rosette loses its tender nutty character.",
      "Pale, stretched leaves mean too little light or EC run too low for the cool pace it grows at."
    ],
    "harvest_markers": [
      "Cut the whole rosette while tight and deep-green, before any stalk rises."
    ],
    "story": {
      "he": null,
      "en": null
    }
  },
  "cuore-di-bue": {
    "id": "cuore-di-bue",
    "species": "tomato",
    "cultivar": "Cuore di Bue",
    "provenance": "Liguria, Italy",
    "protocol_version": 1,
    "inherits": "tomato",
    "stages": {
      "flowering": {
        "ec": {
          "target": 2400,
          "tolerance": 12,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "ec": {
          "target": 2800,
          "tolerance": 12,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 22,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "The oxheart fruit cracks at the shoulder when water swings during fruiting — hold a steady feed, don't chase EC up and down.",
      "Thin walls and watery flesh mean EC ran low through fruiting; the cultivar's dense, meaty character needs the higher steady band.",
      "Blossom-end rot at the pointed tip is the classic Cuore di Bue tell of erratic water reaching the fast-swelling fruit."
    ],
    "harvest_markers": [
      "Ready when the heart-shaped fruit is full red-orange with the ribbed shoulders coloured through; pick on the vine for the dense, low-seed flesh chefs want.",
      "Hold quality a few days past the supermarket point — this is a flavour tomato, not a shipping one."
    ],
    "story": {
      "he": "קואורה די בואה — עגבניית 'לב השור' ההיסטורית מליגוריה: בשרנית, מעט גרעינים, מתוקה. עגבניית שף, לא עגבניית מדף.",
      "en": "Cuore di Bue — the Ligurian 'oxheart' tomato: large, ribbed, meaty and low-seed, with a deep sweet flesh. A chef's slicing tomato, priced on flavour, never on the shelf."
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
  },
  "mache-loire": {
    "id": "mache-loire",
    "species": "corn_salad",
    "cultivar": "Mâche (Lamb's Lettuce)",
    "provenance": "Loire, France",
    "protocol_version": 1,
    "inherits": "corn_salad",
    "stages": {
      "vegetative": {
        "ec": {
          "target": 1000,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 15,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "A true cold-season green: above the band the tender rosette bolts and loses its nutty, buttery character.",
      "Loose, stretched rosettes mean too little light for the slow cool pace it sets at."
    ],
    "harvest_markers": [
      "Cut the whole rosette while small, tight and deep-green — mâche is sold as a delicate whole-rosette green, not loose leaf."
    ],
    "story": {
      "he": "מאש (חסת הטלה) מעמק הלואר — ירק עלים עדין וחורפי, אגוזי ובוטרי, נמכר כרוזטה שלמה. אוהב קור.",
      "en": "Mâche (Lamb's Lettuce) from the Loire — a delicate cold-season green, nutty and buttery, sold as a whole tender rosette. A true cold-lover."
    }
  },
  "padron-peppers": {
    "id": "padron-peppers",
    "species": "pepper",
    "cultivar": "Padrón Peppers",
    "provenance": "Galicia, Spain",
    "protocol_version": 1,
    "inherits": "pepper",
    "stages": {
      "fruiting": {
        "ec": {
          "target": 2100,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 23,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "Picked too late or grown too hot and dry, more of the crop turns fiery — Padrón's charm is that most stay mild, an occasional one hot.",
      "Flower drop in a cold root zone cuts the continuous small-fruit set this cultivar is grown for."
    ],
    "harvest_markers": [
      "Pick small and green — 4–6 cm — for the mild, blistered-in-oil tapa; size up only if a buyer wants the hotter, riper fruit.",
      "Harvest continuously; frequent picking keeps the plant setting new pods."
    ],
    "story": {
      "he": "פלפלי פדרון — הפלפל הגלייסיאני הקטן שאוכלים מטוגן בשמן ומלח: רובם עדינים, ומדי פעם אחד חריף. נקטפים קטנים וירוקים.",
      "en": "Padrón Peppers — the small Galician frying pepper: blistered in oil and salt, most mild with the occasional hot one. Picked small and green, sold by the handful to chefs."
    }
  },
  "pepper": {
    "id": "pepper",
    "species": "pepper",
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
          "target": 1200,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 23,
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
          "target": 1800,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 23,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "ph": {
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 2000,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 23,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "ph": {
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 2200,
          "tolerance": 20,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 23,
          "tolerance": 4,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "Flower drop when the root zone runs cold or EC swings — peppers want warmth and a steady feed.",
      "Blossom-end rot on the fruit tracks erratic watering more than a true calcium shortage."
    ],
    "harvest_markers": [
      "Frying peppers are picked young and green; leave a few to redden only if the buyer wants the sweeter, riper fruit."
    ],
    "story": {
      "he": null,
      "en": null
    }
  },
  "radicchio-rosso-di-treviso-igp": {
    "id": "radicchio-rosso-di-treviso-igp",
    "species": "chicory",
    "cultivar": "Radicchio Rosso di Treviso IGP",
    "provenance": "Veneto, Italy",
    "protocol_version": 1,
    "inherits": "chicory",
    "stages": {
      "vegetative": {
        "ec": {
          "target": 1500,
          "tolerance": 15,
          "tolerance_mode": "percent"
        },
        "water_temp": {
          "target": 17,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "flowering": {
        "water_temp": {
          "target": 14,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      },
      "fruiting": {
        "water_temp": {
          "target": 14,
          "tolerance": 3,
          "tolerance_mode": "absolute"
        }
      }
    },
    "stress_signatures": [
      "Without a genuine cool turn at the finish the head stays green and bitter-flat — the deep wine-red and the clean edge only set in the cold.",
      "A warm root zone late in heading gives a loose, pale head with none of the elongated Treviso form."
    ],
    "harvest_markers": [
      "Ready when the elongated head is firm, deep wine-red with bright white ribs, after a cool finish (the traditional imbianchimento blanching deepens it further).",
      "The colour is the product — a green-shouldered head is not yet Treviso."
    ],
    "story": {
      "he": "רדיקיו רוסו די טרוויזו IGP — העולש האדום המוארך של ונטו, אדום-יין עם צלעות לבנות, מר-נקי. צריך סיום קר כדי לקבל את הצבע והטעם.",
      "en": "Radicchio Rosso di Treviso IGP — the elongated red chicory of the Veneto: wine-red with white ribs and a clean bitter edge. The colour and flavour are earned only by a cold finish."
    }
  },
  "tomato": {
    "id": "tomato",
    "species": "tomato",
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
          "target": 1500,
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
          "target": 2000,
          "tolerance": 20,
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
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 2500,
          "tolerance": 20,
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
          "target": 6.2,
          "tolerance": 0.4,
          "tolerance_mode": "absolute"
        },
        "ec": {
          "target": 3000,
          "tolerance": 20,
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
      "Blossom-end rot points to calcium reaching the fruit too slowly — usually erratic water or EC swings, not a calcium shortage alone.",
      "Leaf roll and flower drop appear when root-zone water runs hot; fruit set stalls above the band."
    ],
    "harvest_markers": [
      "Pick at full colour on the vine for flavour; heritage types hold quality a few days past the supermarket point."
    ],
    "story": {
      "he": null,
      "en": null
    }
  }
};
