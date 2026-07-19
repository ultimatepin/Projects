// Released English Riftbound Champion Deck products through Unleashed.
//
// Counts in `cards` include the Chosen Champion. At game setup that one copy
// moves from the 40-card Main Deck to the Champion Zone.

export const CHAMPION_DECK_CATALOG_METADATA = {
  schemaVersion: 1,
  verifiedAsOf: '2026-07-14',
  language: 'en',
  scope: {
    included: 'Individually released, ready-to-play Champion Deck products',
    excluded: 'Origins Proving Grounds learning decks and unreleased Vendetta products',
    releasedProductCount: 7,
  },
  expectedComposition: {
    legend: 1,
    mainDeck: 40,
    runes: 12,
    battlefields: 3,
    distinctBattlefields: 3,
    packagedDeckCards: 56,
    maxCopiesPerName: 3,
  },
  mappingPolicy: {
    printing: 'The normal, non-variant printing named by the published collector number',
    localCatalog: 'public/cards.json',
    mainDeckIncludesChosenChampion: true,
  },
  sources: {
    officialOriginsProductLine: 'https://playriftbound.com/en-us/news/announcements/how-to-buy-riftbound/',
    officialDeckbuildingRules: 'https://playriftbound.com/en-us/news/rules-and-releases/deckbuilding-primer/',
    officialSpiritforgedLists: 'https://playriftbound.com/en-us/news/announcements/spiritforged-precons-fiora-rumble/',
    officialUnleashedLists: 'https://playriftbound.com/en-us/news/announcements/vi--vex-champion-decks/',
    officialPreconBanException: 'https://playriftbound.com/en-us/news/announcements/april-2026-tournament-rules-update-changelog/',
  },
  validationSummary: {
    status: 'valid',
    decksChecked: 7,
    missingLocalCardIds: 0,
    ambiguousPrintingMappings: 0,
    countFailures: 0,
    copyLimitFailures: 0,
    notes: [
      'Riot publishes machine-readable card numbers for Spiritforged and Unleashed.',
      'The three Origins compositions use Riftbound.gg deck records because Riot does not publish a text decklist.',
      'Riot calls the included matching units “Champion Unit Options.” championId selects the intended one-copy Epic as the ready-to-play default in later products; championOptions preserves every legal in-box alternative.',
      'The exact Jinx product includes three currently banned cards. Riot permits an unchanged preconstructed list at Casual organized-play level; modified versions must remove them.',
    ],
  },
}

export const CHAMPION_DECKS = [
  {
    id: 'precon-ogn-jinx',
    name: 'Jinx — Origins Champion Deck',
    champion: 'Jinx',
    setId: 'OGN',
    productCode: 'RB-01PD01-EN',
    legendId: 'ogn-251-298',
    championId: 'ogn-030-298',
    championOptions: ['ogn-030-298'],
    cards: {
      'ogn-030-298': 1,
      'ogn-036-298': 1,
      'ogn-195-298': 1,
      'ogn-185-298': 3,
      'ogn-178-298': 2,
      'ogn-165-298': 2,
      'ogn-019-298': 3,
      'ogn-011-298': 1,
      'ogn-006-298': 3,
      'ogn-003-298': 3,
      'ogn-002-298': 3,
      'ogn-182-298': 3,
      'ogn-180-298': 2,
      'ogn-169-298': 3,
      'ogn-168-298': 3,
      'ogn-024-298': 2,
      'ogn-008-298': 2,
      'ogn-001-298': 2,
    },
    runes: {
      'ogn-007-298': 6,
      'ogn-166-298': 6,
    },
    battlefields: {
      'ogn-285-298': 1,
      'ogn-289-298': 1,
      'ogn-298-298': 1,
    },
    provenance: {
      compositionAuthority: 'community-database',
      compositionUrl: 'https://riftbound.gg/decks/jinx-premade-origins-champion-deck',
      dataUrl: 'https://api.dotgg.gg/cgfw/getdeck?game=riftbound&slug=jinx-premade-origins-champion-deck&mode=boards',
      productAuthority: 'official',
      productUrl: 'https://playriftbound.com/en-us/news/announcements/how-to-buy-riftbound/',
      chosenChampionBasis: 'The list contains one Jinx, Demolitionist; it is the sealed deck’s matching one-copy Champion.',
    },
    validation: validDeckValidation(['ogn-182-298', 'ogn-168-298', 'ogn-285-298']),
  },
  {
    id: 'precon-ogn-viktor',
    name: 'Viktor — Origins Champion Deck',
    champion: 'Viktor',
    setId: 'OGN',
    productCode: 'RB-01PD02-EN',
    legendId: 'ogn-265-298',
    championId: 'ogn-117-298',
    championOptions: ['ogn-117-298'],
    cards: {
      'ogn-117-298': 1,
      'ogn-118-298': 1,
      'ogn-222-298': 3,
      'ogn-216-298': 3,
      'ogn-208-298': 3,
      'ogn-111-298': 1,
      'ogn-103-298': 3,
      'ogn-086-298': 2,
      'ogn-084-298': 3,
      'ogn-101-298': 2,
      'ogn-090-298': 2,
      'ogn-233-298': 1,
      'ogn-213-298': 2,
      'ogn-209-298': 3,
      'ogn-206-298': 2,
      'ogn-095-298': 2,
      'ogn-094-298': 2,
      'ogn-093-298': 2,
      'ogn-083-298': 2,
    },
    runes: {
      'ogn-089-298': 6,
      'ogn-214-298': 6,
    },
    battlefields: {
      'ogn-275-298': 1,
      'ogn-293-298': 1,
      'ogn-294-298': 1,
    },
    provenance: {
      compositionAuthority: 'community-database',
      compositionUrl: 'https://riftbound.gg/decks/viktor-premade-origins-champion-deck',
      dataUrl: 'https://api.dotgg.gg/cgfw/getdeck?game=riftbound&slug=viktor-premade-origins-champion-deck&mode=boards',
      productAuthority: 'official',
      productUrl: 'https://playriftbound.com/en-us/news/announcements/how-to-buy-riftbound/',
      chosenChampionBasis: 'The list contains one Viktor, Innovator; it is the only matching Viktor Champion in the product.',
    },
    validation: validDeckValidation(),
  },
  {
    id: 'precon-ogn-lee-sin',
    name: 'Lee Sin — Origins Champion Deck',
    champion: 'Lee Sin',
    setId: 'OGN',
    productCode: 'RB-01PD03-EN',
    legendId: 'ogn-257-298',
    championId: 'ogn-151-298',
    championOptions: ['ogn-151-298'],
    cards: {
      'ogn-151-298': 1,
      'ogn-157-298': 1,
      'ogn-147-298': 3,
      'ogn-142-298': 2,
      'ogn-137-298': 2,
      'ogn-136-298': 3,
      'ogn-135-298': 2,
      'ogn-132-298': 3,
      'ogn-125-298': 2,
      'ogn-065-298': 3,
      'ogn-055-298': 3,
      'ogn-052-298': 3,
      'ogn-152-298': 1,
      'ogn-060-298': 1,
      'ogn-128-298': 3,
      'ogn-058-298': 3,
      'ogn-053-298': 2,
      'ogn-043-298': 2,
    },
    runes: {
      'ogn-042-298': 6,
      'ogn-126-298': 6,
    },
    battlefields: {
      'ogn-280-298': 1,
      'ogn-282-298': 1,
      'ogn-289-298': 1,
    },
    provenance: {
      compositionAuthority: 'community-database',
      compositionUrl: 'https://riftbound.gg/decks/lee-sin-premade-origins-champion-deck',
      dataUrl: 'https://api.dotgg.gg/cgfw/getdeck?game=riftbound&slug=lee-sin-premade-origins-champion-deck&mode=boards',
      productAuthority: 'official',
      productUrl: 'https://playriftbound.com/en-us/news/announcements/how-to-buy-riftbound/',
      chosenChampionBasis: 'Riot’s official Deckbuilding Primer explicitly identifies Lee Sin, Centered as this deck’s Chosen Champion.',
    },
    validation: validDeckValidation(),
  },
  {
    id: 'precon-sfd-rumble',
    name: 'Rumble — Spiritforged Champion Deck',
    champion: 'Rumble',
    setId: 'SFD',
    productCode: 'RB-02PD01-EN',
    legendId: 'sfd-181-221',
    championId: 'sfd-089-221',
    championOptions: ['sfd-089-221', 'sfd-026-221'],
    cards: {
      'sfd-089-221': 1,
      'sfd-026-221': 2,
      'sfd-071-221': 2,
      'sfd-069-221': 3,
      'sfd-065-221': 3,
      'sfd-062-221': 3,
      'sfd-021-221': 2,
      'sfd-007-221': 3,
      'ogn-016-298': 3,
      'sfd-022-221': 1,
      'sfd-019-221': 1,
      'sfd-182-221': 1,
      'sfd-076-221': 3,
      'sfd-070-221': 2,
      'sfd-066-221': 2,
      'ogn-105-298': 1,
      'ogn-095-298': 2,
      'ogn-083-298': 2,
      'ogn-024-298': 3,
    },
    runes: {
      'ogn-007-298': 6,
      'ogn-089-298': 6,
    },
    battlefields: {
      'sfd-212-221': 1,
      'sfd-215-221': 1,
      'sfd-220-221': 1,
    },
    provenance: {
      compositionAuthority: 'official',
      compositionUrl: 'https://playriftbound.com/en-us/news/announcements/spiritforged-precons-fiora-rumble/',
      chosenChampionBasis: 'Rumble, Scrapper is the product’s one-copy Epic matching Champion.',
    },
    validation: validDeckValidation(),
  },
  {
    id: 'precon-sfd-fiora',
    name: 'Fiora — Spiritforged Champion Deck',
    champion: 'Fiora',
    setId: 'SFD',
    productCode: 'RB-02PD02-EN',
    legendId: 'sfd-205-221',
    championId: 'sfd-180-221',
    championOptions: ['sfd-180-221', 'sfd-110-221'],
    cards: {
      'sfd-180-221': 1,
      'sfd-110-221': 2,
      'sfd-116-221': 1,
      'sfd-113-221': 2,
      'sfd-103-221': 2,
      'sfd-099-221': 2,
      'sfd-093-221': 2,
      'sfd-167-221': 2,
      'sfd-157-221': 2,
      'sfd-156-221': 2,
      'ogn-136-298': 2,
      'sfd-172-221': 1,
      'sfd-161-221': 3,
      'sfd-108-221': 3,
      'sfd-095-221': 3,
      'sfd-206-221': 1,
      'sfd-107-221': 3,
      'sfd-106-221': 2,
      'sfd-097-221': 2,
      'ogn-229-298': 2,
    },
    runes: {
      'ogn-126-298': 6,
      'ogn-214-298': 6,
    },
    battlefields: {
      'sfd-213-221': 1,
      'sfd-218-221': 1,
      'sfd-221-221': 1,
    },
    provenance: {
      compositionAuthority: 'official',
      compositionUrl: 'https://playriftbound.com/en-us/news/announcements/spiritforged-precons-fiora-rumble/',
      chosenChampionBasis: 'Fiora, Worthy is the product’s one-copy Epic matching Champion.',
    },
    validation: validDeckValidation(),
  },
  {
    id: 'precon-unl-vex',
    name: 'Vex — Unleashed Champion Deck',
    champion: 'Vex',
    setId: 'UNL',
    productCode: 'RB-03PD02-EN',
    legendId: 'unl-193-219',
    championId: 'unl-150-219',
    championOptions: ['unl-150-219', 'sfd-146-221', 'unl-055-219'],
    cards: {
      'unl-150-219': 1,
      'unl-055-219': 2,
      'sfd-146-221': 1,
      'unl-194-219': 1,
      'unl-141-219': 1,
      'unl-127-219': 2,
      'unl-126-219': 1,
      'unl-052-219': 1,
      'unl-050-219': 1,
      'unl-048-219': 2,
      'unl-047-219': 2,
      'unl-043-219': 1,
      'unl-041-219': 2,
      'unl-040-219': 3,
      'unl-036-219': 2,
      'unl-035-219': 1,
      'unl-034-219': 2,
      'unl-136-219': 1,
      'unl-133-219': 2,
      'unl-039-219': 2,
      'unl-134-219': 2,
      'unl-042-219': 3,
      'unl-038-219': 2,
      'unl-031-219': 2,
    },
    runes: {
      'ogn-042-298': 6,
      'ogn-166-298': 6,
    },
    battlefields: {
      'unl-207-219': 1,
      'unl-213-219': 1,
      'unl-214-219': 1,
    },
    provenance: {
      compositionAuthority: 'official',
      compositionUrl: 'https://playriftbound.com/en-us/news/announcements/vi--vex-champion-decks/',
      chosenChampionBasis: 'Vex, Apathetic is the product’s one-copy Epic matching Champion; Riot labels all included Vex units as Champion Unit options.',
    },
    validation: validDeckValidation(),
  },
  {
    id: 'precon-unl-vi',
    name: 'Vi — Unleashed Champion Deck',
    champion: 'Vi',
    setId: 'UNL',
    productCode: 'RB-03PD01-EN',
    legendId: 'unl-187-219',
    championId: 'unl-030-219',
    championOptions: ['unl-030-219', 'unl-176-219', 'ogn-036-298'],
    cards: {
      'unl-030-219': 1,
      'unl-176-219': 2,
      'ogn-036-298': 1,
      'unl-026-219': 1,
      'unl-024-219': 1,
      'unl-018-219': 2,
      'unl-012-219': 2,
      'unl-008-219': 2,
      'unl-006-219': 2,
      'unl-002-219': 3,
      'unl-001-219': 1,
      'unl-163-219': 2,
      'unl-156-219': 2,
      'unl-154-219': 2,
      'unl-153-219': 2,
      'unl-188-219': 1,
      'unl-161-219': 2,
      'sfd-009-221': 2,
      'unl-175-219': 1,
      'unl-159-219': 1,
      'unl-017-219': 2,
      'unl-015-219': 2,
      'unl-010-219': 2,
      'unl-009-219': 1,
    },
    runes: {
      'ogn-007-298': 6,
      'ogn-214-298': 6,
    },
    battlefields: {
      'unl-215-219': 1,
      'unl-217-219': 1,
      'unl-218-219': 1,
    },
    provenance: {
      compositionAuthority: 'official',
      compositionUrl: 'https://playriftbound.com/en-us/news/announcements/vi--vex-champion-decks/',
      chosenChampionBasis: 'Vi, Hotheaded is the product’s one-copy Epic matching Champion; Riot labels all included Vi units as Champion Unit options.',
    },
    validation: validDeckValidation(),
  },
]

function validDeckValidation(bannedCardIds = []) {
  return {
    status: 'valid-preconstructed-composition',
    legendCount: 1,
    mainDeckCount: 40,
    runeCount: 12,
    battlefieldCount: 3,
    distinctBattlefieldCount: 3,
    packagedCardCount: 56,
    chosenChampionIncludedInMainCount: true,
    maxPrintedCopies: 3,
    currentlyBannedCardIds: bannedCardIds,
    generallyConstructedLegal: bannedCardIds.length === 0,
    casualExactPreconException: bannedCardIds.length > 0,
    missingCardIds: [],
    ambiguousMappings: [],
  }
}

export function validateChampionDeckCatalog(cards) {
  const catalog = new Map(cards.map((card) => [card.id, card]))

  return CHAMPION_DECKS.map((deck) => {
    const zoneCount = (zone) => Object.values(zone).reduce((total, count) => total + count, 0)
    const referencedIds = [
      deck.legendId,
      ...Object.keys(deck.cards),
      ...Object.keys(deck.runes),
      ...Object.keys(deck.battlefields),
    ]
    const missingCardIds = referencedIds.filter((id) => !catalog.has(id))
    const wrongTypes = [
      ...(catalog.get(deck.legendId)?.type === 'Legend' ? [] : [deck.legendId]),
      ...Object.keys(deck.cards).filter((id) => !['Unit', 'Gear', 'Spell'].includes(catalog.get(id)?.type)),
      ...Object.keys(deck.runes).filter((id) => catalog.get(id)?.type !== 'Rune'),
      ...Object.keys(deck.battlefields).filter((id) => catalog.get(id)?.type !== 'Battlefield'),
    ]
    const variantMappingFailures = referencedIds.filter((id) => catalog.get(id) && catalog.get(id).variant !== '')
    const mainDeckCount = zoneCount(deck.cards)
    const runeCount = zoneCount(deck.runes)
    const battlefieldCount = zoneCount(deck.battlefields)
    const copyLimitFailures = Object.entries(deck.cards)
      .reduce((counts, [id, count]) => {
        const name = catalog.get(id)?.name || id
        counts.set(name, (counts.get(name) || 0) + count)
        return counts
      }, new Map())
    const nameCopyLimitFailures = [...copyLimitFailures]
      .filter(([, count]) => count > 3)
      .map(([name, count]) => ({ name, count }))
    const chosenChampionIncluded = Boolean(deck.cards[deck.championId])
    const chosenChampionIsUnit = catalog.get(deck.championId)?.type === 'Unit'
    const championOptionsValid = deck.championOptions.every((id) => catalog.get(id)?.type === 'Unit' && deck.cards[id])
    const distinctBattlefieldNames = new Set(
      Object.keys(deck.battlefields).map((id) => catalog.get(id)?.name).filter(Boolean),
    ).size
    const valid = missingCardIds.length === 0
      && wrongTypes.length === 0
      && variantMappingFailures.length === 0
      && nameCopyLimitFailures.length === 0
      && mainDeckCount === 40
      && runeCount === 12
      && battlefieldCount === 3
      && Object.keys(deck.battlefields).length === 3
      && distinctBattlefieldNames === 3
      && chosenChampionIncluded
      && chosenChampionIsUnit
      && championOptionsValid

    return {
      id: deck.id,
      valid,
      mainDeckCount,
      runeCount,
      battlefieldCount,
      packagedCardCount: 1 + mainDeckCount + runeCount + battlefieldCount,
      missingCardIds,
      wrongTypes,
      variantMappingFailures,
      copyLimitFailures: nameCopyLimitFailures,
      distinctBattlefieldNames,
      chosenChampionIncluded,
      chosenChampionIsUnit,
      championOptionsValid,
    }
  })
}
