import crypto from "node:crypto";

export const OFFICIAL_CORE_RULES_VERSION = "2026-03-30";
export const OFFICIAL_GAME_PROFILE = "standard-constructed-duel";
export const VICTORY_SCORE = 8;

const MAIN_DECK_SIZE = 40;
const RUNE_DECK_SIZE = 12;
const BATTLEFIELD_POOL_SIZE = 3;
const MAX_MANUAL_OPERATIONS = 24;
const MAX_HISTORY = 200;
const PLAYER_ZONE_NAMES = [
  "legend",
  "champion",
  "mainDeck",
  "runeDeck",
  "hand",
  "base",
  "runes",
  "trash",
  "banishment",
];

export class OfficialGameError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OfficialGameError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Validate and normalize a Standard Constructed Duel deck.
 *
 * Current catalog exports do not contain reliable champion tags, Signature
 * markers, Power costs, or complete multi-domain identities. When those
 * fields are absent, the corresponding official checks are reported in
 * `metadataLimitations` rather than guessed from artwork-facing fields.
 */
export function validateDeckDefinition(
  raw,
  cardsById,
  { allowExactPrecon = false } = {},
) {
  const source = asObject(raw);
  const catalog = normalizeCatalog(cardsById);
  const exactPreconDeclared = Boolean(allowExactPrecon && source.isExactPrecon === true);
  const legendId = cleanId(source.legendId);
  const chosenChampionId = cleanId(source.chosenChampionId ?? source.championId);
  const mainDeck = expandCardList(source.mainDeck ?? source.cards, "main deck");
  const runeDeck = expandCardList(source.runeDeck ?? source.runes, "rune deck");
  const battlefields = expandCardList(
    source.battlefields ?? source.battlefieldIds,
    "battlefields",
  );

  if (!legendId) fail("LEGEND_REQUIRED", "Choose exactly one Champion Legend.");
  if (!chosenChampionId) {
    fail("CHOSEN_CHAMPION_REQUIRED", "Choose one Champion Unit from the Main Deck.");
  }
  if (mainDeck.length !== MAIN_DECK_SIZE) {
    fail(
      "INVALID_MAIN_DECK_SIZE",
      `A Standard Constructed Main Deck must contain exactly ${MAIN_DECK_SIZE} cards.`,
      { actual: mainDeck.length },
    );
  }
  if (runeDeck.length !== RUNE_DECK_SIZE) {
    fail(
      "INVALID_RUNE_DECK_SIZE",
      `A Rune Deck must contain exactly ${RUNE_DECK_SIZE} runes.`,
      { actual: runeDeck.length },
    );
  }
  if (battlefields.length !== BATTLEFIELD_POOL_SIZE) {
    fail(
      "INVALID_BATTLEFIELD_COUNT",
      `A Standard Constructed deck must provide exactly ${BATTLEFIELD_POOL_SIZE} battlefields.`,
      { actual: battlefields.length },
    );
  }

  const legend = requireCatalogCard(catalog, legendId, "Legend");
  requireType(legend, "Legend", "The selected legend");
  requireNotBanned(legend, exactPreconDeclared);

  const chosen = requireCatalogCard(catalog, chosenChampionId, "Chosen Champion");
  requireType(chosen, "Unit", "The Chosen Champion");
  requireNotBanned(chosen, exactPreconDeclared);

  const mainCards = mainDeck.map((id) => {
    const card = requireCatalogCard(catalog, id, "Main Deck");
    const type = cardType(card);
    if (!new Set(["unit", "gear", "spell"]).has(type)) {
      fail(
        "INVALID_MAIN_DECK_CARD_TYPE",
        `${card.name || id} cannot be included in a Main Deck.`,
      );
    }
    requireNotBanned(card, exactPreconDeclared);
    return card;
  });

  const runeCards = runeDeck.map((id) => {
    const card = requireCatalogCard(catalog, id, "Rune Deck");
    requireType(card, "Rune", `${card.name || id}`);
    requireNotBanned(card, exactPreconDeclared);
    return card;
  });

  const battlefieldCards = battlefields.map((id) => {
    const card = requireCatalogCard(catalog, id, "Battlefield pool");
    requireType(card, "Battlefield", `${card.name || id}`);
    requireNotBanned(card, exactPreconDeclared);
    return card;
  });

  if (!mainDeck.includes(chosenChampionId)) {
    fail(
      "CHOSEN_CHAMPION_NOT_IN_MAIN_DECK",
      "The Chosen Champion must be one of the 40 Main Deck cards.",
    );
  }

  const countsByName = countCardsByName(mainCards);
  const overCopyLimit = [...countsByName.entries()].find(([, count]) => count > 3);
  if (overCopyLimit) {
    fail(
      "CARD_COPY_LIMIT",
      `${overCopyLimit[0]} appears ${overCopyLimit[1]} times; the limit is 3 by card name.`,
    );
  }

  const battlefieldNames = battlefieldCards.map(cardNameKey);
  if (new Set(battlefieldNames).size !== battlefieldNames.length) {
    fail(
      "DUPLICATE_BATTLEFIELD_NAME",
      "All three battlefields must have unique names.",
    );
  }

  const metadataLimitations = [];
  const legendDomains = structuredDomains(legend);
  if (legendDomains.length) {
    for (const card of [...mainCards, ...runeCards, ...battlefieldCards]) {
      const domains = structuredDomains(card, { allowFactionFallback: true });
      if (domains.some((domain) => !legendDomains.includes(domain))) {
        fail(
          "DOMAIN_IDENTITY_MISMATCH",
          `${card.name || card.id} is outside the Champion Legend's Domain Identity.`,
        );
      }
    }
  } else {
    metadataLimitations.push(
      "Domain Identity was not checked because the catalog has no structured legend domains.",
    );
  }

  const legendChampionTags = structuredChampionTags(legend);
  const chosenChampionTags = structuredChampionTags(chosen);
  const chosenIsChampion = structuredChampionFlag(chosen);
  if (chosenIsChampion === false) {
    fail(
      "CHOSEN_CARD_NOT_CHAMPION_UNIT",
      `${chosen.name || chosen.id} is a Unit but is not marked as a Champion Unit.`,
    );
  }
  if (legendChampionTags.length && chosenChampionTags.length) {
    if (!chosenChampionTags.some((tag) => legendChampionTags.includes(tag))) {
      fail(
        "CHAMPION_TAG_MISMATCH",
        "The Chosen Champion tag must match the Champion Legend tag.",
      );
    }
  } else {
    metadataLimitations.push(
      "Champion subtype/tag matching was not checked because the catalog has no structured champion metadata.",
    );
  }

  const signatureCards = mainCards.filter(isStructuredSignature);
  if (signatureCards.length > 3) {
    fail(
      "SIGNATURE_CARD_LIMIT",
      `A deck may contain at most 3 total Signature cards; this deck has ${signatureCards.length}.`,
    );
  }
  if (signatureCards.length && legendChampionTags.length) {
    for (const card of signatureCards) {
      const tags = structuredChampionTags(card);
      if (!tags.some((tag) => legendChampionTags.includes(tag))) {
        fail(
          "SIGNATURE_TAG_MISMATCH",
          `${card.name || card.id} does not match the Champion Legend's tag.`,
        );
      }
    }
  } else if (!mainCards.some(hasStructuredSignatureField)) {
    metadataLimitations.push(
      "Signature-card limits were not checked because the catalog has no structured Signature metadata.",
    );
  }

  return {
    legendId,
    chosenChampionId,
    mainDeck: [...mainDeck],
    runeDeck: [...runeDeck],
    battlefields: [...battlefields],
    format: OFFICIAL_GAME_PROFILE,
    exactPreconDeclared,
    metadataLimitations: [...new Set(metadataLimitations)],
  };
}

/** Create a ready-to-mulligan official Duel game. */
export function createOfficialGame(players, cardsById) {
  if (!Array.isArray(players) || players.length !== 2) {
    fail("TWO_PLAYERS_REQUIRED", "Official Duel requires exactly two players.");
  }
  const catalog = normalizeCatalog(cardsById);
  const ids = players.map((player) => cleanId(player?.id));
  if (ids.some((id) => !id) || new Set(ids).size !== 2) {
    fail("INVALID_PLAYERS", "Both Duel players need unique non-empty IDs.");
  }

  const firstIndex = crypto.randomInt(2);
  const normalizedPlayers = players.map((rawPlayer, seat) => {
    const definition = validateDeckDefinition(
      rawPlayer.deck ?? rawPlayer.deckDefinition ?? rawPlayer,
      catalog,
      { allowExactPrecon: Boolean(rawPlayer.allowExactPrecon) },
    );
    return createGamePlayer(rawPlayer, definition, catalog, seat + 1);
  });

  const game = {
    id: crypto.randomUUID(),
    rules: {
      coreVersion: OFFICIAL_CORE_RULES_VERSION,
      profile: OFFICIAL_GAME_PROFILE,
      victoryScore: VICTORY_SCORE,
      automation: "official-process-manual-card-effects",
    },
    status: "mulligan",
    winnerPlayerId: null,
    result: null,
    firstPlayerId: normalizedPlayers[firstIndex].id,
    secondPlayerId: normalizedPlayers[1 - firstIndex].id,
    turn: {
      number: 0,
      activePlayerId: normalizedPlayers[firstIndex].id,
      phase: "mulligan",
      state: "neutral-open",
      priorityPlayerId: null,
      focusPlayerId: null,
    },
    pendingDecision: null,
    showdown: null,
    combat: null,
    players: normalizedPlayers,
    battlefields: normalizedPlayers.map((player) => {
      const selectedId = randomChoice(player.deckDefinition.battlefields);
      return {
        instanceId: crypto.randomUUID(),
        cardId: selectedId,
        ownerPlayerId: player.id,
        controllerPlayerId: null,
        contestedByPlayerId: null,
        scoredTurnByPlayer: {},
        cards: [],
      };
    }),
    history: [],
    processedActionIds: [],
  };

  for (const player of game.players) drawFromMainDeckWithoutBurnout(player, 4);
  record(game, "SETUP", "Legends and Chosen Champions were revealed; decks were shuffled and each player drew 4.");
  record(game, "FIRST_PLAYER", `${getPlayer(game, game.firstPlayerId).name} was randomly selected to play first.`);
  return game;
}

/** Apply one validated player action. Mutates and returns `game`. */
export function applyOfficialAction(game, playerId, rawAction, cardsById) {
  if (!game || typeof game !== "object") fail("INVALID_GAME", "Game state is missing.");
  const player = getPlayer(game, playerId);
  const catalog = normalizeCatalog(cardsById);
  const action = asObject(rawAction);
  const type = canonicalActionType(action.type);
  const payload = asObject(action.payload ?? action);
  const actionId = cleanOptionalText(action.actionId ?? payload.actionId, 100);

  if (actionId && game.processedActionIds.includes(`${player.id}:${actionId}`)) return game;
  const snapshot = structuredClone(game);
  try {
    if (game.status === "finished" && type !== "REQUEST_UNDO") {
      fail("GAME_FINISHED", "This game has already finished.");
    }

    switch (type) {
      case "MULLIGAN":
      case "SUBMIT_MULLIGAN":
        submitMulligan(game, player, payload);
        break;
      case "USE_RUNE":
        activateRune(game, player, payload, catalog);
        break;
      case "PLAY_CARD":
        playCard(game, player, payload, catalog);
        break;
      case "STANDARD_MOVE":
        standardMove(game, player, payload, catalog);
        break;
      case "PASS_FOCUS":
        passFocus(game, player, catalog);
        break;
      case "ASSIGN_COMBAT_DAMAGE":
        assignCombatDamage(game, player, payload, catalog);
        break;
      case "APPLY_EFFECT":
      case "APPLY_MANUAL_EFFECT":
        applyManualEffect(game, player, payload, catalog);
        break;
      case "END_MAIN":
      case "END_TURN":
        endTurn(game, player, catalog);
        break;
      case "CONCEDE":
        concede(game, player);
        break;
      default:
        fail("UNKNOWN_OFFICIAL_ACTION", `Unknown official game action: ${type || "(empty)"}.`);
    }

    if (actionId) {
      game.processedActionIds.push(`${player.id}:${actionId}`);
      if (game.processedActionIds.length > 500) game.processedActionIds.shift();
    }
  } catch (error) {
    restoreGameState(game, snapshot);
    throw error;
  }
  return game;
}

/** Serialize public state plus only the viewer's private information. */
export function serialiseOfficialGame(game, viewerId) {
  const viewer = game.players.some((player) => player.id === viewerId) ? viewerId : null;
  return {
    id: game.id,
    rules: { ...game.rules },
    status: game.status,
    winnerPlayerId: game.winnerPlayerId,
    result: game.result ? { ...game.result } : null,
    firstPlayerId: game.firstPlayerId,
    secondPlayerId: game.secondPlayerId,
    turn: { ...game.turn },
    pendingDecision:
      game.pendingDecision && game.pendingDecision.playerId === viewer
        ? structuredClone(game.pendingDecision)
        : game.pendingDecision
          ? { playerId: game.pendingDecision.playerId, kind: game.pendingDecision.kind }
          : null,
    showdown: game.showdown ? structuredClone(game.showdown) : null,
    combat: serialiseCombat(game.combat),
    battlefields: game.battlefields.map((field) => ({
      instanceId: field.instanceId,
      cardId: field.cardId,
      ownerPlayerId: field.ownerPlayerId,
      controllerPlayerId: field.controllerPlayerId,
      contestedByPlayerId: field.contestedByPlayerId,
      scoredThisTurnByViewer: Boolean(
        viewer && field.scoredTurnByPlayer[viewer] === game.turn.number,
      ),
      cards: field.cards.map((card) =>
        serialiseCard(card, !card.faceDown || card.controllerPlayerId === viewer),
      ),
    })),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      score: player.score,
      xp: player.xp,
      turnsTaken: player.turnsTaken,
      mulliganSubmitted: player.mulliganSubmitted,
      metadataLimitations: [...player.deckDefinition.metadataLimitations],
      runePool: {
        energy: player.runePool.energy,
        powerByDomain: { ...player.runePool.powerByDomain },
      },
      zones: {
        legend: player.zones.legend.map((card) => serialiseCard(card, true)),
        champion: player.zones.champion.map((card) => serialiseCard(card, true)),
        mainDeck: { count: player.zones.mainDeck.length },
        runeDeck: { count: player.zones.runeDeck.length },
        hand: {
          count: player.zones.hand.length,
          cards:
            player.id === viewer
              ? player.zones.hand.map((card) => serialiseCard(card, true))
              : undefined,
        },
        base: player.zones.base.map((card) => serialiseCard(card, true)),
        runes: player.zones.runes.map((card) => serialiseCard(card, true)),
        trash: player.zones.trash.map((card) => serialiseCard(card, true)),
        banishment: player.zones.banishment.map((card) => serialiseCard(card, true)),
      },
    })),
    history: game.history.map((entry) => ({ ...entry, data: structuredClone(entry.data) })),
  };
}

function createGamePlayer(rawPlayer, definition, catalog, seat) {
  const mainIds = [...definition.mainDeck];
  const chosenIndex = mainIds.indexOf(definition.chosenChampionId);
  mainIds.splice(chosenIndex, 1);
  const playerId = cleanId(rawPlayer.id);
  return {
    id: playerId,
    name: cleanName(rawPlayer.name),
    seat,
    score: 0,
    xp: 0,
    turnsTaken: 0,
    mulliganSubmitted: false,
    deckDefinition: definition,
    runePool: { energy: 0, powerByDomain: {} },
    zones: {
      legend: [createInstance(definition.legendId, playerId, catalog)],
      champion: [createInstance(definition.chosenChampionId, playerId, catalog)],
      mainDeck: shuffle(mainIds.map((id) => createInstance(id, playerId, catalog))),
      runeDeck: shuffle(
        definition.runeDeck.map((id) => createInstance(id, playerId, catalog)),
      ),
      hand: [],
      base: [],
      runes: [],
      trash: [],
      banishment: [],
    },
  };
}

function createInstance(cardId, ownerPlayerId, catalog) {
  const card = requireCatalogCard(catalog, cardId, "Game card");
  return {
    instanceId: crypto.randomUUID(),
    cardId,
    cardType: cardType(card),
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    exhausted: false,
    faceDown: false,
    damage: 0,
    buff: false,
    counters: {},
  };
}

function submitMulligan(game, player, payload) {
  if (game.status !== "mulligan") {
    fail("MULLIGAN_CLOSED", "The mulligan step has ended.");
  }
  if (player.mulliganSubmitted) {
    fail("MULLIGAN_ALREADY_SUBMITTED", "This player already submitted a mulligan.");
  }
  const ids = Array.isArray(payload.instanceIds) ? payload.instanceIds.map(String) : [];
  if (ids.length > 2 || new Set(ids).size !== ids.length) {
    fail("INVALID_MULLIGAN", "Choose zero, one, or two different opening-hand cards.");
  }
  const selected = ids.map((id) => {
    const index = player.zones.hand.findIndex((card) => card.instanceId === id);
    if (index < 0) fail("MULLIGAN_CARD_NOT_FOUND", "A selected card is not in your hand.");
    return player.zones.hand[index];
  });
  player.zones.hand = player.zones.hand.filter((card) => !ids.includes(card.instanceId));
  drawFromMainDeckWithoutBurnout(player, selected.length);
  for (const card of shuffle(selected)) {
    resetForNonBoardZone(card);
    player.zones.mainDeck.unshift(card);
  }
  player.mulliganSubmitted = true;
  record(
    game,
    "MULLIGAN",
    `${player.name} completed a mulligan with ${selected.length} card${selected.length === 1 ? "" : "s"}.`,
  );

  if (game.players.every((candidate) => candidate.mulliganSubmitted)) {
    game.status = "playing";
    beginTurn(game, game.firstPlayerId);
  }
}

function beginTurn(game, playerId) {
  if (game.status !== "playing") return;
  const player = getPlayer(game, playerId);
  game.turn.number += 1;
  game.turn.activePlayerId = player.id;
  game.turn.state = "neutral-open";
  game.turn.priorityPlayerId = null;
  game.turn.focusPlayerId = null;
  player.turnsTaken += 1;

  game.turn.phase = "awaken";
  readyControlledObjects(game, player.id);

  game.turn.phase = "beginning";
  for (const battlefield of game.battlefields) {
    if (battlefield.controllerPlayerId === player.id) {
      scoreBattlefield(game, player, battlefield, "hold");
      runCleanup(game, null);
      if (game.status === "finished") return;
    }
  }

  game.turn.phase = "channel";
  const channelCount = player.id === game.secondPlayerId && player.turnsTaken === 1 ? 3 : 2;
  channelRunes(game, player, channelCount, false);

  game.turn.phase = "draw";
  drawCards(game, player, 1, "turn draw");
  clearAllRunePools(game);
  runCleanup(game, null);
  if (game.status === "finished") return;

  game.turn.phase = "main";
  game.turn.state = "neutral-open";
  record(game, "TURN", `${player.name} began turn ${game.turn.number}.`);
}

function activateRune(game, player, payload, catalog) {
  assertPlaying(game);
  assertPlayerMayTakeAction(game, player);
  const instanceId = String(payload.instanceId ?? payload.runeId ?? "");
  const index = player.zones.runes.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) fail("RUNE_NOT_FOUND", "That rune is not in your base.");
  const rune = player.zones.runes[index];
  const mode = String(payload.mode || "energy").toLowerCase();
  if (mode === "energy") {
    if (rune.exhausted) fail("RUNE_EXHAUSTED", "An exhausted rune cannot add Energy again.");
    rune.exhausted = true;
    player.runePool.energy += 1;
    record(game, "RUNE_ENERGY", `${player.name} exhausted a rune to add 1 Energy.`);
    return;
  }
  if (mode === "power") {
    player.zones.runes.splice(index, 1);
    const domain = runeDomain(requireCatalogCard(catalog, rune.cardId, "Rune"));
    player.runePool.powerByDomain[domain] =
      (player.runePool.powerByDomain[domain] || 0) + 1;
    resetForNonBoardZone(rune);
    player.zones.runeDeck.unshift(rune);
    record(game, "RUNE_POWER", `${player.name} recycled a rune to add 1 ${domain} Power.`);
    return;
  }
  fail("INVALID_RUNE_MODE", "A rune can add Energy or matching-domain Power.");
}

function playCard(game, player, payload, catalog) {
  assertPlaying(game);
  assertPlayerMayTakeAction(game, player);
  const instanceId = String(payload.instanceId || "");
  const sourceZone = payload.from === "champion" ? "champion" : "hand";
  const source = player.zones[sourceZone];
  const sourceIndex = source.findIndex((card) => card.instanceId === instanceId);
  if (sourceIndex < 0) {
    fail("CARD_NOT_AVAILABLE", `That card is not in your ${sourceZone === "hand" ? "hand" : "Champion Zone"}.`);
  }
  const instance = source[sourceIndex];
  const card = requireCatalogCard(catalog, instance.cardId, "Played card");
  const type = cardType(card);
  if (!new Set(["unit", "gear", "spell"]).has(type)) {
    fail("CARD_NOT_PLAYABLE", "Only Units, Gear, and Spells can be played this way.");
  }
  const destination = String(payload.destination || "base");
  let destinationField = null;
  if (type === "unit" && destination !== "base") {
    destinationField = getBattlefield(game, destination);
    const hasPrintedPermission = payload.permission === "card-text";
    if (destinationField.controllerPlayerId !== player.id && !hasPrintedPermission) {
      fail(
        "INVALID_PLAY_DESTINATION",
        "A Unit normally plays only to its controller's base or controlled battlefield.",
      );
    }
  }
  spendDeclaredResources(player, payload.spend ?? payload.declaredSpend);
  source.splice(sourceIndex, 1);

  if (type === "spell") {
    resetForNonBoardZone(instance);
    player.zones.trash.push(instance);
    record(game, "PLAY_SPELL", `${player.name} played ${card.name || "a spell"}; its printed effect is player-resolved.`);
    advanceFocusAfterAction(game, player.id);
    return;
  }
  if (type === "gear") {
    instance.exhausted = false;
    instance.controllerPlayerId = player.id;
    player.zones.base.push(instance);
    record(game, "PLAY_GEAR", `${player.name} played ${card.name || "Gear"} to base.`);
    advanceFocusAfterAction(game, player.id);
    return;
  }
  instance.exhausted = true;
  instance.controllerPlayerId = player.id;
  if (destination === "base") {
    player.zones.base.push(instance);
  } else {
    destinationField.cards.push(instance);
    if (destinationField.controllerPlayerId !== player.id) {
      contestBattlefield(game, destinationField, player.id);
    }
  }
  record(
    game,
    "PLAY_UNIT",
    `${player.name} played ${card.name || "a Unit"} ${destination === "base" ? "to base" : "to a battlefield"}.`,
  );
  advanceFocusAfterAction(game, player.id);
}

function standardMove(game, player, payload, catalog) {
  assertPlaying(game);
  if (
    game.turn.activePlayerId !== player.id ||
    game.turn.phase !== "main" ||
    game.turn.state !== "neutral-open" ||
    game.showdown
  ) {
    fail("STANDARD_MOVE_NOT_AVAILABLE", "Standard Move is available only in your Neutral Open Main Phase.");
  }
  const ids = Array.isArray(payload.unitIds)
    ? payload.unitIds.map(String)
    : [String(payload.instanceId ?? payload.unitId ?? "")].filter(Boolean);
  if (!ids.length || new Set(ids).size !== ids.length) {
    fail("INVALID_STANDARD_MOVE", "Choose one or more different Units to move.");
  }
  const destination = String(payload.destination || "");
  const destinationField = destination === "base" ? null : getBattlefield(game, destination);
  const located = ids.map((id) => locateInstance(game, id));

  for (const location of located) {
    if (!location || location.card.controllerPlayerId !== player.id) {
      fail("UNIT_NOT_CONTROLLED", "Every moving Unit must be controlled by you.");
    }
    const card = requireCatalogCard(catalog, location.card.cardId, "Moving Unit");
    if (cardType(card) !== "unit") fail("NOT_A_UNIT", "Only Units can use Standard Move.");
    if (!new Set(["base", "battlefield"]).has(location.zone)) {
      fail("INVALID_MOVE_ORIGIN", "A Standard Move must begin at base or a battlefield.");
    }
    if (location.card.exhausted) fail("UNIT_EXHAUSTED", "An exhausted Unit cannot pay the Standard Move cost.");
    if (location.zone === "base" && !destinationField) {
      fail("INVALID_STANDARD_MOVE", "A Unit at base must Standard Move to a battlefield.");
    }
    if (location.zone === "battlefield" && destinationField) {
      if (location.battlefield.instanceId === destinationField.instanceId) {
        fail("SAME_MOVE_LOCATION", "A Unit cannot move to its current location.");
      }
      if (payload.permission !== "ganking") {
        fail("GANKING_REQUIRED", "Battlefield-to-battlefield Standard Move requires Ganking.");
      }
    }
  }

  for (const location of located) location.card.exhausted = true;
  for (const location of located) {
    removeLocated(location);
    if (destinationField) destinationField.cards.push(location.card);
    else player.zones.base.push(location.card);
  }

  record(
    game,
    "STANDARD_MOVE",
    `${player.name} exhausted and moved ${located.length} Unit${located.length === 1 ? "" : "s"}.`,
  );
  if (destinationField && destinationField.controllerPlayerId !== player.id) {
    contestBattlefield(game, destinationField, player.id);
  }
  runCleanup(game, catalog, { preserveContestedField: destinationField?.instanceId });
}

function contestBattlefield(game, battlefield, playerId) {
  battlefield.contestedByPlayerId = playerId;
  const controllers = unitControllersAt(game, battlefield);
  const hasOpponent = controllers.some((id) => id !== playerId);
  const defenderId = controllers.find((id) => id !== playerId) ?? battlefield.controllerPlayerId;
  game.showdown = {
    battlefieldId: battlefield.instanceId,
    type: hasOpponent ? "combat" : "non-combat",
    initiatorPlayerId: playerId,
    focusPlayerId: playerId,
    consecutivePasses: 0,
  };
  game.turn.phase = hasOpponent ? "combat" : "showdown";
  game.turn.state = "showdown-open";
  game.turn.focusPlayerId = playerId;
  if (hasOpponent) {
    game.combat = {
      battlefieldId: battlefield.instanceId,
      attackerPlayerId: playerId,
      defenderPlayerId: defenderId,
      stage: "showdown",
      assignments: {},
      mightTotals: {},
    };
  }
  record(
    game,
    hasOpponent ? "COMBAT_SHOWDOWN" : "SHOWDOWN",
    `${getPlayer(game, playerId).name} contested a battlefield; a ${hasOpponent ? "combat " : ""}showdown opened.`,
  );
}

function passFocus(game, player, catalog) {
  assertPlaying(game);
  if (!game.showdown || game.showdown.focusPlayerId !== player.id) {
    fail("NO_FOCUS", "You do not currently have Focus in a showdown.");
  }
  game.showdown.consecutivePasses += 1;
  record(game, "PASS_FOCUS", `${player.name} passed Focus.`);
  if (game.showdown.consecutivePasses < game.players.length) {
    const next = opponentOf(game, player.id);
    game.showdown.focusPlayerId = next.id;
    game.turn.focusPlayerId = next.id;
    return;
  }
  closeShowdown(game, catalog);
}

function closeShowdown(game, catalog) {
  const showdown = game.showdown;
  if (!showdown) return;
  const battlefield = getBattlefield(game, showdown.battlefieldId);
  const controllers = unitControllersAt(game, battlefield);
  if (showdown.type === "combat" && controllers.length >= 2) {
    game.combat.stage = "assign-attacker";
    game.combat.mightTotals = {
      [game.combat.attackerPlayerId]: totalMightAt(
        game,
        battlefield,
        game.combat.attackerPlayerId,
        catalog,
      ),
      [game.combat.defenderPlayerId]: totalMightAt(
        game,
        battlefield,
        game.combat.defenderPlayerId,
        catalog,
      ),
    };
    game.turn.state = "showdown-closed";
    game.turn.focusPlayerId = null;
    return;
  }

  game.showdown = null;
  game.combat = null;
  game.turn.focusPlayerId = null;
  game.turn.state = "neutral-open";
  game.turn.phase = "main";
  if (controllers.length === 1) establishControl(game, battlefield, controllers[0], catalog);
  else if (!controllers.length) clearBattlefieldControl(game, battlefield);
  runCleanup(game, catalog);
}

function assignCombatDamage(game, player, payload, catalog) {
  assertPlaying(game);
  const combat = game.combat;
  if (!combat || !new Set(["assign-attacker", "assign-defender"]).has(combat.stage)) {
    fail("NO_COMBAT_ASSIGNMENT", "Combat is not awaiting damage assignment.");
  }
  const expectedPlayerId =
    combat.stage === "assign-attacker" ? combat.attackerPlayerId : combat.defenderPlayerId;
  if (player.id !== expectedPlayerId) {
    fail("WRONG_DAMAGE_ASSIGNER", "The other combat player assigns damage first.");
  }
  const battlefield = getBattlefield(game, combat.battlefieldId);
  const opponentId =
    player.id === combat.attackerPlayerId ? combat.defenderPlayerId : combat.attackerPlayerId;
  const targets = unitsAt(game, battlefield, opponentId, catalog);
  const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
  const total = totalMightAt(game, battlefield, player.id, catalog);
  validateDamageAllocations(allocations, targets, total, catalog);
  combat.assignments[player.id] = allocations.map((allocation) => ({
    instanceId: String(allocation.instanceId ?? allocation.targetId),
    amount: toInteger(allocation.amount, 0, 999, "damage assignment"),
  }));
  combat.mightTotals[player.id] = total;
  record(game, "ASSIGN_DAMAGE", `${player.name} assigned ${total} combat damage.`);

  if (combat.stage === "assign-attacker") {
    combat.stage = "assign-defender";
    return;
  }
  resolveCombat(game, catalog);
}

function validateDamageAllocations(allocations, targets, total, catalog) {
  if (!Array.isArray(allocations)) fail("INVALID_DAMAGE_ASSIGNMENT", "Damage allocations must be a list.");
  const targetById = new Map(targets.map((target) => [target.instanceId, target]));
  const seen = new Set();
  let assigned = 0;
  const positive = [];
  for (const allocation of allocations) {
    const id = String(allocation.instanceId ?? allocation.targetId ?? "");
    if (!targetById.has(id) || seen.has(id)) {
      fail("INVALID_DAMAGE_TARGET", "Combat damage must target each opposing Unit at most once.");
    }
    seen.add(id);
    const amount = toInteger(allocation.amount, 0, 999, "damage assignment");
    assigned += amount;
    if (amount > 0) positive.push({ target: targetById.get(id), amount });
  }
  if (assigned !== total) {
    fail("UNASSIGNED_COMBAT_DAMAGE", `Assign exactly ${total} combat damage.`, {
      assigned,
      required: total,
    });
  }
  for (let index = 0; index < positive.length - 1; index += 1) {
    const { target, amount } = positive[index];
    const lethal = Math.max(1, currentMight(target, catalog) - target.damage);
    if (amount !== lethal) {
      fail(
        "INVALID_LETHAL_ORDER",
        "Assign exactly lethal damage to a Unit before assigning damage to another Unit.",
      );
    }
  }
}

function resolveCombat(game, catalog) {
  const combat = game.combat;
  const battlefield = getBattlefield(game, combat.battlefieldId);
  for (const allocations of Object.values(combat.assignments)) {
    for (const allocation of allocations) {
      const location = locateInstance(game, allocation.instanceId);
      if (location?.zone === "battlefield" && location.battlefield === battlefield) {
        location.card.damage += allocation.amount;
      }
    }
  }

  killLethalUnits(game, catalog);
  healAllUnits(game, catalog);
  const defendersRemain = unitsAt(game, battlefield, combat.defenderPlayerId, catalog).length > 0;
  if (defendersRemain) {
    for (const attacker of [...unitsAt(game, battlefield, combat.attackerPlayerId, catalog)]) {
      recallPermanent(game, attacker.instanceId, catalog);
    }
  }

  const controllers = unitControllersAt(game, battlefield);
  battlefield.contestedByPlayerId = null;
  game.combat = null;
  game.showdown = null;
  game.turn.state = "neutral-open";
  game.turn.focusPlayerId = null;
  game.turn.phase = "main";
  if (controllers.length === 1) establishControl(game, battlefield, controllers[0], catalog);
  else if (!controllers.length) clearBattlefieldControl(game, battlefield);
  record(game, "COMBAT_RESOLVED", "Combat damage resolved; surviving Units were healed and control was updated.");
  runCleanup(game, catalog);
}

function establishControl(game, battlefield, playerId, catalog) {
  const changed = battlefield.controllerPlayerId !== playerId;
  battlefield.controllerPlayerId = playerId;
  battlefield.contestedByPlayerId = null;
  if (changed) scoreBattlefield(game, getPlayer(game, playerId), battlefield, "conquer", catalog);
}

function clearBattlefieldControl(game, battlefield) {
  if (!battlefield.controllerPlayerId) return;
  battlefield.controllerPlayerId = null;
  for (const card of [...battlefield.cards]) {
    if (card.faceDown) moveCardToTrash(game, card.instanceId);
  }
}

function scoreBattlefield(game, player, battlefield, method, catalog = null) {
  if (battlefield.scoredTurnByPlayer[player.id] === game.turn.number) return;
  battlefield.scoredTurnByPlayer[player.id] = game.turn.number;
  const isFinalPoint = player.score >= game.rules.victoryScore - 1;
  let gainedPoint = false;
  if (!isFinalPoint || method === "hold") {
    player.score += 1;
    gainedPoint = true;
  } else {
    const scoredEveryBattlefield = game.battlefields.every(
      (field) => field.scoredTurnByPlayer[player.id] === game.turn.number,
    );
    if (scoredEveryBattlefield) {
      player.score += 1;
      gainedPoint = true;
    } else {
      drawCards(game, player, 1, "final-point Conquer replacement");
    }
  }
  record(
    game,
    method === "hold" ? "HOLD" : "CONQUER",
    gainedPoint
      ? `${player.name} ${method === "hold" ? "Held" : "Conquered"} a battlefield and gained 1 point.`
      : `${player.name} Conquered but had not scored every battlefield this turn, so drew 1 instead of gaining the final point.`,
  );
  if (catalog) runCleanup(game, catalog);
}

function applyManualEffect(game, player, payload, catalog) {
  assertPlaying(game);
  assertPlayerMayTakeAction(game, player);
  const operations = Array.isArray(payload.operations) ? payload.operations : [];
  if (!operations.length || operations.length > MAX_MANUAL_OPERATIONS) {
    fail(
      "INVALID_MANUAL_EFFECT",
      `A manual effect needs 1-${MAX_MANUAL_OPERATIONS} constrained operations.`,
    );
  }
  const description = cleanOptionalText(payload.description, 160) || "a printed card effect";
  for (const rawOperation of operations) {
    if (game.status === "finished") break;
    applyManualOperation(game, player, asObject(rawOperation), catalog);
  }
  record(game, "MANUAL_EFFECT", `${player.name} resolved ${description}.`);
  runCleanup(game, catalog);
  advanceFocusAfterAction(game, player.id);
}

function applyManualOperation(game, actingPlayer, operation, catalog) {
  const type = canonicalActionType(operation.type);
  switch (type) {
    case "DRAW": {
      const target = operation.playerId
        ? getPlayer(game, String(operation.playerId))
        : actingPlayer;
      drawCards(game, target, toInteger(operation.count ?? 1, 1, 40, "draw count"), "card effect");
      return;
    }
    case "DISCARD": {
      const location = requireVisibleOrOwnedLocation(game, actingPlayer, operation.instanceId);
      if (location.zone !== "hand") fail("INVALID_DISCARD", "Only a card in hand can be discarded.");
      moveCardToTrash(game, location.card.instanceId);
      return;
    }
    case "RECYCLE": {
      const location = requireVisibleOrOwnedLocation(game, actingPlayer, operation.instanceId);
      recycleCard(game, location.card.instanceId, catalog);
      return;
    }
    case "BANISH": {
      const location = requireVisibleOrOwnedLocation(game, actingPlayer, operation.instanceId);
      banishCard(game, location.card.instanceId);
      return;
    }
    case "KILL": {
      const location = requireVisibleOrOwnedLocation(game, actingPlayer, operation.instanceId);
      if (!new Set(["base", "battlefield"]).has(location.zone)) {
        fail("INVALID_KILL", "Only a Permanent on the board can be killed.");
      }
      const card = requireCatalogCard(catalog, location.card.cardId, "Killed card");
      if (!new Set(["unit", "gear"]).has(cardType(card))) {
        fail("INVALID_KILL", "Only Units and Gear can be killed.");
      }
      moveCardToTrash(game, location.card.instanceId);
      return;
    }
    case "RECALL":
      recallPermanent(game, operation.instanceId, catalog);
      return;
    case "MOVE":
      effectMove(game, operation, catalog);
      return;
    case "DAMAGE": {
      const location = requirePublicBoardLocation(game, operation.instanceId);
      const card = requireCatalogCard(catalog, location.card.cardId, "Damaged card");
      if (cardType(card) !== "unit") fail("INVALID_DAMAGE_TARGET", "Only Units can take damage.");
      location.card.damage += toInteger(operation.amount, 1, 999, "damage");
      return;
    }
    case "HEAL": {
      const location = requirePublicBoardLocation(game, operation.instanceId);
      const amount = operation.amount === "all" || operation.amount === undefined
        ? location.card.damage
        : toInteger(operation.amount, 1, 999, "healing");
      location.card.damage = Math.max(0, location.card.damage - amount);
      return;
    }
    case "READY":
    case "EXHAUST": {
      const location = requirePublicBoardLocation(game, operation.instanceId, { includeRunes: true });
      location.card.exhausted = type === "EXHAUST";
      return;
    }
    case "BUFF": {
      const location = requirePublicBoardLocation(game, operation.instanceId);
      const card = requireCatalogCard(catalog, location.card.cardId, "Buff target");
      if (cardType(card) !== "unit") fail("INVALID_BUFF_TARGET", "Only Units can be buffed.");
      location.card.buff = operation.value === undefined ? true : Boolean(operation.value);
      return;
    }
    case "CHANNEL": {
      const target = operation.playerId
        ? getPlayer(game, String(operation.playerId))
        : actingPlayer;
      channelRunes(
        game,
        target,
        toInteger(operation.count ?? 1, 1, 12, "channel count"),
        Boolean(operation.exhausted),
      );
      return;
    }
    case "GAIN_POINTS":
    case "GAIN_POINT": {
      const target = operation.playerId
        ? getPlayer(game, String(operation.playerId))
        : actingPlayer;
      const count = toInteger(operation.count ?? operation.amount ?? 1, 1, 20, "point gain");
      target.score += count;
      return;
    }
    case "GAIN_XP": {
      const target = operation.playerId
        ? getPlayer(game, String(operation.playerId))
        : actingPlayer;
      const count = toInteger(operation.count ?? operation.amount ?? 1, 1, 999, "XP gain");
      target.xp += count;
      return;
    }
    case "SPEND_XP": {
      const target = operation.playerId
        ? getPlayer(game, String(operation.playerId))
        : actingPlayer;
      const count = toInteger(operation.count ?? operation.amount ?? 1, 1, 999, "XP spend");
      if (target.xp < count) {
        fail("INSUFFICIENT_XP", `${target.name} does not have ${count} XP to spend.`);
      }
      target.xp -= count;
      return;
    }
    case "CREATE_TOKEN":
      createTokens(game, actingPlayer, operation, catalog);
      return;
    default:
      fail(
        "UNSAFE_MANUAL_OPERATION",
        `Manual operation ${type || "(empty)"} is not in the official tabletop whitelist.`,
      );
  }
}

function createTokens(game, actingPlayer, operation, catalog) {
  const owner = operation.playerId
    ? getPlayer(game, String(operation.playerId))
    : actingPlayer;
  const cardId = cleanId(operation.cardId);
  const card = requireCatalogCard(catalog, cardId, "Created token");
  const type = cardType(card);
  if (!isOfficialTokenRecord(card) || !new Set(["unit", "gear"]).has(type)) {
    fail(
      "INVALID_TOKEN_CARD",
      "CREATE_TOKEN accepts only a catalog-backed official Unit or Gear token record.",
    );
  }

  const destination = String(operation.destination || "base");
  const battlefield = destination === "base" ? null : getBattlefield(game, destination);
  if (type === "gear" && battlefield) {
    fail("INVALID_TOKEN_DESTINATION", "A Gear token can be created only at its controller's base.");
  }
  const count = toInteger(operation.count ?? operation.amount ?? 1, 1, 20, "token count");
  const exhausted = operation.exhausted === undefined
    ? type === "unit"
    : Boolean(operation.exhausted);

  for (let index = 0; index < count; index += 1) {
    const token = createInstance(cardId, owner.id, catalog);
    token.token = true;
    token.exhausted = exhausted;
    token.ownerPlayerId = owner.id;
    token.controllerPlayerId = owner.id;
    if (battlefield) battlefield.cards.push(token);
    else owner.zones.base.push(token);
  }

  if (
    battlefield &&
    type === "unit" &&
    battlefield.controllerPlayerId !== owner.id &&
    !game.showdown &&
    !game.combat
  ) {
    contestBattlefield(game, battlefield, owner.id);
  }
}

function isOfficialTokenRecord(card) {
  const id = String(card?.id || "").toLowerCase();
  const variant = String(card?.variant || "").toLowerCase();
  const originToken = /^ogn-(271|272|273|274)(?:-|$)/.test(id)
    && cardType(card) === "unit"
    && normalizeTag(card?.faction) === "colorless"
    && Number(card?.stats?.energy ?? card?.energy ?? 0) === 0;
  const tokenVariant = /^t\d{2,}$/.test(variant)
    && normalizeTag(card?.faction) === "colorless";
  return originToken || tokenVariant;
}

function effectMove(game, operation, catalog) {
  const location = locateInstance(game, String(operation.instanceId || ""));
  if (!location || !new Set(["base", "battlefield"]).has(location.zone)) {
    fail("INVALID_EFFECT_MOVE", "A printed move effect can move only a Unit on the board.");
  }
  const card = requireCatalogCard(catalog, location.card.cardId, "Moved card");
  if (cardType(card) !== "unit") fail("INVALID_EFFECT_MOVE", "Only Units can move.");
  const destination = String(operation.destination || "");
  const controller = getPlayer(game, location.card.controllerPlayerId);
  if (destination === "base") {
    removeLocated(location);
    controller.zones.base.push(location.card);
    return;
  }
  const battlefield = getBattlefield(game, destination);
  if (location.zone === "battlefield" && location.battlefield === battlefield) return;
  removeLocated(location);
  battlefield.cards.push(location.card);
  if (battlefield.controllerPlayerId !== controller.id) {
    contestBattlefield(game, battlefield, controller.id);
  }
}

function endTurn(game, player, catalog) {
  assertPlaying(game);
  if (
    game.turn.activePlayerId !== player.id ||
    game.turn.phase !== "main" ||
    game.showdown ||
    game.combat
  ) {
    fail("CANNOT_END_TURN", "Resolve the current showdown or combat before ending your Main Phase.");
  }
  game.turn.phase = "ending";
  runCleanup(game, catalog);
  if (game.status === "finished") return;
  healAllUnits(game, catalog);
  clearAllRunePools(game);
  record(game, "END_TURN", `${player.name} ended their turn.`);
  beginTurn(game, opponentOf(game, player.id).id);
}

function concede(game, player) {
  if (game.status === "finished") fail("GAME_FINISHED", "This game has already finished.");
  const opponent = opponentOf(game, player.id);
  finishGame(game, opponent.id, "concession", `${player.name} conceded the game.`);
}

function drawCards(game, player, rawCount, reason) {
  let remaining = rawCount;
  let sequentialBurnouts = 0;
  while (remaining > 0 && game.status !== "finished") {
    const available = Math.min(remaining, player.zones.mainDeck.length);
    drawFromMainDeckWithoutBurnout(player, available);
    remaining -= available;
    if (!remaining) break;

    sequentialBurnouts += 1;
    recycleTrashForBurnout(player);
    const opponent = opponentOf(game, player.id);
    opponent.score += 1;
    record(
      game,
      "BURNOUT",
      `${player.name} burned out; ${opponent.name} gained 1 point.`,
      { burnedOutPlayerId: player.id, scoringPlayerId: opponent.id },
    );
    if (sequentialBurnouts >= 2) checkVictory(game, { immediate: true });
  }
  record(game, "DRAW", `${player.name} drew ${rawCount - remaining} card${rawCount - remaining === 1 ? "" : "s"} for ${reason}.`);
}

function drawFromMainDeckWithoutBurnout(player, count) {
  for (let index = 0; index < count; index += 1) {
    const card = player.zones.mainDeck.pop();
    if (!card) break;
    player.zones.hand.push(card);
  }
}

function recycleTrashForBurnout(player) {
  const mainCards = [];
  const runeCards = [];
  for (const card of player.zones.trash) {
    resetForNonBoardZone(card);
    if (card.cardType === "rune") runeCards.push(card);
    else mainCards.push(card);
  }
  player.zones.trash = [];
  player.zones.mainDeck.push(...shuffle(mainCards));
  player.zones.runeDeck.unshift(...shuffle(runeCards));
}

function channelRunes(game, player, count, exhausted) {
  const actual = Math.min(count, player.zones.runeDeck.length);
  for (let index = 0; index < actual; index += 1) {
    const rune = player.zones.runeDeck.pop();
    rune.exhausted = exhausted;
    rune.faceDown = false;
    player.zones.runes.push(rune);
  }
  record(game, "CHANNEL", `${player.name} channeled ${actual} rune${actual === 1 ? "" : "s"}.`);
}

function spendDeclaredResources(player, rawSpend) {
  if (rawSpend === undefined || rawSpend === null) return;
  const spend = asObject(rawSpend);
  const energy = toInteger(spend.energy ?? 0, 0, 999, "Energy spend");
  if (player.runePool.energy < energy) fail("INSUFFICIENT_ENERGY", "Not enough Energy is in your Rune Pool.");
  const power = asObject(spend.powerByDomain ?? spend.power);
  for (const [domain, rawAmount] of Object.entries(power)) {
    const amount = toInteger(rawAmount, 0, 999, "Power spend");
    if ((player.runePool.powerByDomain[domain] || 0) < amount) {
      fail("INSUFFICIENT_POWER", `Not enough ${domain} Power is in your Rune Pool.`);
    }
  }
  player.runePool.energy -= energy;
  for (const [domain, rawAmount] of Object.entries(power)) {
    player.runePool.powerByDomain[domain] -= Number(rawAmount);
  }
}

function runCleanup(game, catalog, { preserveContestedField = null } = {}) {
  if (game.status !== "playing") return;
  checkVictory(game);
  if (game.status === "finished") return;
  if (catalog) killLethalUnits(game, catalog);
  if (!game.showdown && !game.combat) {
    for (const battlefield of game.battlefields) {
      if (battlefield.instanceId === preserveContestedField) continue;
      if (
        battlefield.controllerPlayerId &&
        !unitsAt(game, battlefield, battlefield.controllerPlayerId, catalog).length
      ) {
        clearBattlefieldControl(game, battlefield);
      }
    }
  }
  checkVictory(game);
}

function checkVictory(game, { immediate = false } = {}) {
  if (game.status === "finished") return true;
  const leaders = [...game.players].sort((a, b) => b.score - a.score);
  if (
    leaders[0].score >= game.rules.victoryScore &&
    leaders[0].score > leaders[1].score
  ) {
    finishGame(
      game,
      leaders[0].id,
      immediate ? "sequential-burnout" : "victory-score-cleanup",
      `${leaders[0].name} won with ${leaders[0].score} points.`,
    );
    return true;
  }
  return false;
}

function finishGame(game, winnerPlayerId, reason, message) {
  game.status = "finished";
  game.winnerPlayerId = winnerPlayerId;
  game.result = { winnerPlayerId, reason };
  game.turn.phase = "finished";
  game.turn.state = "neutral-open";
  game.turn.priorityPlayerId = null;
  game.turn.focusPlayerId = null;
  game.showdown = null;
  game.combat = null;
  record(game, "GAME_FINISHED", message, { winnerPlayerId, reason });
}

function killLethalUnits(game, catalog) {
  let killed = true;
  while (killed) {
    killed = false;
    const candidates = [];
    for (const player of game.players) candidates.push(...player.zones.base);
    for (const battlefield of game.battlefields) candidates.push(...battlefield.cards);
    for (const instance of candidates) {
      const card = catalog ? catalogGet(catalog, instance.cardId) : null;
      if (
        card &&
        cardType(card) === "unit" &&
        instance.damage > 0 &&
        instance.damage >= currentMight(instance, catalog)
      ) {
        moveCardToTrash(game, instance.instanceId);
        killed = true;
      }
    }
  }
}

function healAllUnits(game, catalog) {
  for (const player of game.players) {
    for (const card of player.zones.base) {
      if (cardType(catalogGet(catalog, card.cardId)) === "unit") card.damage = 0;
    }
  }
  for (const battlefield of game.battlefields) {
    for (const card of battlefield.cards) {
      if (cardType(catalogGet(catalog, card.cardId)) === "unit") card.damage = 0;
    }
  }
}

function readyControlledObjects(game, playerId) {
  const player = getPlayer(game, playerId);
  for (const zone of [player.zones.legend, player.zones.base, player.zones.runes]) {
    for (const card of zone) if (card.controllerPlayerId === playerId) card.exhausted = false;
  }
  for (const battlefield of game.battlefields) {
    for (const card of battlefield.cards) {
      if (card.controllerPlayerId === playerId) card.exhausted = false;
    }
  }
}

function clearAllRunePools(game) {
  for (const player of game.players) {
    player.runePool.energy = 0;
    player.runePool.powerByDomain = {};
  }
}

function moveCardToTrash(game, instanceId) {
  const location = locateInstance(game, instanceId);
  if (!location) fail("CARD_NOT_FOUND", "Card instance not found.");
  removeLocated(location);
  if (location.card.token) return;
  const owner = getPlayer(game, location.card.ownerPlayerId);
  resetForNonBoardZone(location.card);
  owner.zones.trash.push(location.card);
}

function recycleCard(game, instanceId, catalog) {
  const location = locateInstance(game, instanceId);
  if (!location) fail("CARD_NOT_FOUND", "Card instance not found.");
  removeLocated(location);
  if (location.card.token) return;
  const owner = getPlayer(game, location.card.ownerPlayerId);
  const card = requireCatalogCard(catalog, location.card.cardId, "Recycled card");
  resetForNonBoardZone(location.card);
  if (cardType(card) === "rune") owner.zones.runeDeck.unshift(location.card);
  else owner.zones.mainDeck.unshift(location.card);
}

function banishCard(game, instanceId) {
  const location = locateInstance(game, instanceId);
  if (!location) fail("CARD_NOT_FOUND", "Card instance not found.");
  removeLocated(location);
  if (location.card.token) return;
  const owner = getPlayer(game, location.card.ownerPlayerId);
  resetForNonBoardZone(location.card);
  owner.zones.banishment.push(location.card);
}

function recallPermanent(game, instanceId, catalog) {
  const location = locateInstance(game, String(instanceId || ""));
  if (!location || location.zone !== "battlefield") {
    fail("INVALID_RECALL", "Only a Permanent at a battlefield can be recalled.");
  }
  const card = requireCatalogCard(catalog, location.card.cardId, "Recalled card");
  if (!new Set(["unit", "gear"]).has(cardType(card))) {
    fail("INVALID_RECALL", "Only Units and Gear can be recalled.");
  }
  removeLocated(location);
  getPlayer(game, location.card.controllerPlayerId).zones.base.push(location.card);
}

function currentMight(instance, catalog) {
  const card = requireCatalogCard(catalog, instance.cardId, "Unit");
  const printed = Number(card.stats?.might ?? card.might ?? 0);
  return Math.max(0, (Number.isFinite(printed) ? printed : 0) + (instance.buff ? 1 : 0));
}

function totalMightAt(game, battlefield, playerId, catalog) {
  return unitsAt(game, battlefield, playerId, catalog).reduce(
    (sum, instance) => sum + currentMight(instance, catalog),
    0,
  );
}

function unitsAt(game, battlefield, playerId, catalog) {
  return battlefield.cards.filter((instance) => {
    if (playerId && instance.controllerPlayerId !== playerId) return false;
    const card = catalog ? catalogGet(catalog, instance.cardId) : null;
    return !catalog || cardType(card) === "unit";
  });
}

function unitControllersAt(game, battlefield) {
  return [
    ...new Set(
      battlefield.cards
        .filter((card) => !card.faceDown)
        .map((card) => card.controllerPlayerId)
        .filter(Boolean),
    ),
  ];
}

function advanceFocusAfterAction(game, playerId) {
  if (!game.showdown || game.showdown.focusPlayerId !== playerId) return;
  const next = opponentOf(game, playerId);
  game.showdown.focusPlayerId = next.id;
  game.showdown.consecutivePasses = 0;
  game.turn.focusPlayerId = next.id;
}

function assertPlaying(game) {
  if (game.status !== "playing") fail("GAME_NOT_PLAYING", "Complete setup and mulligans first.");
}

function assertPlayerMayTakeAction(game, player) {
  if (game.showdown) {
    if (game.showdown.focusPlayerId !== player.id) {
      fail("NO_FOCUS", "Only the player with Focus may take this showdown action.");
    }
    return;
  }
  if (game.turn.activePlayerId !== player.id || game.turn.phase !== "main") {
    fail("NOT_YOUR_MAIN_PHASE", "This action is available only during your Main Phase.");
  }
}

function requireVisibleOrOwnedLocation(game, actingPlayer, rawInstanceId) {
  const location = locateInstance(game, String(rawInstanceId || ""));
  if (!location) fail("CARD_NOT_FOUND", "Card instance not found.");
  const privateZone = new Set(["hand", "mainDeck", "runeDeck"]);
  if (privateZone.has(location.zone) && location.card.ownerPlayerId !== actingPlayer.id) {
    fail("PRIVATE_CARD", "You cannot identify another player's private card this way.");
  }
  if (location.card.faceDown && location.card.controllerPlayerId !== actingPlayer.id) {
    fail("PRIVATE_CARD", "You cannot identify another player's facedown card.");
  }
  return location;
}

function requirePublicBoardLocation(game, rawInstanceId, { includeRunes = false } = {}) {
  const location = locateInstance(game, String(rawInstanceId || ""));
  const allowed = includeRunes
    ? new Set(["base", "battlefield", "runes", "legend"])
    : new Set(["base", "battlefield"]);
  if (!location || !allowed.has(location.zone) || location.card.faceDown) {
    fail("INVALID_PUBLIC_TARGET", "That operation needs a public card on the board.");
  }
  return location;
}

function locateInstance(game, instanceId) {
  for (const player of game.players) {
    for (const zone of PLAYER_ZONE_NAMES) {
      const container = player.zones[zone];
      const index = container.findIndex((card) => card.instanceId === instanceId);
      if (index >= 0) return { card: container[index], container, index, zone, player };
    }
  }
  for (const battlefield of game.battlefields) {
    const index = battlefield.cards.findIndex((card) => card.instanceId === instanceId);
    if (index >= 0) {
      return {
        card: battlefield.cards[index],
        container: battlefield.cards,
        index,
        zone: "battlefield",
        battlefield,
      };
    }
  }
  return null;
}

function removeLocated(location) {
  location.container.splice(location.index, 1);
}

function getPlayer(game, rawPlayerId) {
  const id = String(rawPlayerId || "");
  const player = game.players.find((candidate) => candidate.id === id);
  if (!player) fail("PLAYER_NOT_FOUND", "Player not found in this Duel.");
  return player;
}

function opponentOf(game, playerId) {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!opponent) fail("OPPONENT_NOT_FOUND", "Duel opponent not found.");
  return opponent;
}

function getBattlefield(game, rawBattlefieldId) {
  const id = String(rawBattlefieldId || "");
  const battlefield = game.battlefields.find(
    (candidate) => candidate.instanceId === id || candidate.cardId === id,
  );
  if (!battlefield) fail("BATTLEFIELD_NOT_FOUND", "Battlefield not found.");
  return battlefield;
}

function resetForNonBoardZone(card) {
  card.exhausted = false;
  card.faceDown = false;
  card.damage = 0;
  card.buff = false;
  card.controllerPlayerId = card.ownerPlayerId;
  card.counters = {};
}

function serialiseCard(card, revealIdentity) {
  return {
    instanceId: card.instanceId,
    cardId: revealIdentity ? card.cardId : null,
    ownerPlayerId: card.ownerPlayerId,
    controllerPlayerId: card.controllerPlayerId,
    exhausted: card.exhausted,
    faceDown: card.faceDown,
    damage: card.damage,
    buff: card.buff,
    token: Boolean(card.token),
    counters: { ...card.counters },
  };
}

function serialiseCombat(combat) {
  if (!combat) return null;
  return {
    battlefieldId: combat.battlefieldId,
    attackerPlayerId: combat.attackerPlayerId,
    defenderPlayerId: combat.defenderPlayerId,
    stage: combat.stage,
    mightTotals: { ...combat.mightTotals },
    assignments: structuredClone(combat.assignments),
  };
}

function record(game, type, message, data = {}) {
  game.history.push({
    id: crypto.randomUUID(),
    at: Date.now(),
    turn: game.turn.number,
    type,
    message,
    data: { ...data },
  });
  if (game.history.length > MAX_HISTORY) game.history.shift();
}

function normalizeCatalog(cardsById) {
  if (cardsById instanceof Map) return cardsById;
  if (Array.isArray(cardsById)) return new Map(cardsById.map((card) => [card.id, card]));
  if (cardsById && typeof cardsById === "object") return new Map(Object.entries(cardsById));
  fail("INVALID_CARD_CATALOG", "A card catalog is required.");
}

function catalogGet(catalog, id) {
  return catalog instanceof Map ? catalog.get(id) : catalog?.[id];
}

function requireCatalogCard(catalog, id, label) {
  const card = catalogGet(catalog, id);
  if (!card) fail("UNKNOWN_CARD_ID", `${label} contains unknown card ID ${id || "(empty)"}.`);
  return card;
}

function requireType(card, expected, label) {
  if (cardType(card) !== expected.toLowerCase()) {
    fail("INVALID_CARD_TYPE", `${label} must be a ${expected}.`);
  }
}

function requireNotBanned(card, allowBanned = false) {
  if (!allowBanned && (card.is_banned === true || card.banned === true)) {
    fail("BANNED_CARD", `${card.name || card.id} is banned in Constructed play.`);
  }
}

function cardType(card) {
  return String(card?.type || card?.cardType || "").trim().toLowerCase();
}

function countCardsByName(cards) {
  const counts = new Map();
  for (const card of cards) {
    const name = cardNameKey(card);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

function cardNameKey(card) {
  return String(card?.name || card?.id || "").trim().toLocaleLowerCase("en-US");
}

function structuredDomains(card, { allowFactionFallback = false } = {}) {
  const values = card?.domains ?? card?.domainIdentity ?? card?.domain_identity;
  if (Array.isArray(values)) return values.map(normalizeTag).filter(Boolean);
  if (typeof values === "string") return values.split(/[,+/]/).map(normalizeTag).filter(Boolean);
  if (allowFactionFallback && typeof card?.faction === "string") {
    return [normalizeTag(card.faction)].filter(Boolean);
  }
  return [];
}

function structuredChampionTags(card) {
  const values = card?.championTags ?? card?.champion_tags ?? card?.championTag;
  if (Array.isArray(values)) return values.map(normalizeTag).filter(Boolean);
  if (typeof values === "string") return values.split(/[,/]/).map(normalizeTag).filter(Boolean);
  return [];
}

function structuredChampionFlag(card) {
  if (typeof card?.isChampion === "boolean") return card.isChampion;
  if (typeof card?.is_champion === "boolean") return card.is_champion;
  const subtypes = card?.subtypes ?? card?.traits;
  if (Array.isArray(subtypes)) return subtypes.map(normalizeTag).includes("champion");
  return null;
}

function hasStructuredSignatureField(card) {
  return (
    typeof card?.isSignature === "boolean" ||
    typeof card?.is_signature === "boolean" ||
    Array.isArray(card?.subtypes) ||
    Array.isArray(card?.traits)
  );
}

function isStructuredSignature(card) {
  if (card?.isSignature === true || card?.is_signature === true) return true;
  return [...(card?.subtypes || []), ...(card?.traits || [])]
    .map(normalizeTag)
    .includes("signature");
}

function runeDomain(card) {
  return structuredDomains(card, { allowFactionFallback: true })[0] || "universal";
}

function normalizeTag(value) {
  return String(value || "").trim().toLowerCase();
}

function expandCardList(raw, label) {
  if (Array.isArray(raw)) {
    return raw.map((entry) => {
      const id = cleanId(typeof entry === "string" ? entry : entry?.cardId ?? entry?.id);
      if (!id) fail("INVALID_DECK_ENTRY", `Every ${label} entry needs a card ID.`);
      return id;
    });
  }
  if (raw && typeof raw === "object") {
    const result = [];
    for (const [id, rawCount] of Object.entries(raw)) {
      const count = toInteger(rawCount, 0, 200, `${label} quantity`);
      for (let index = 0; index < count; index += 1) result.push(cleanId(id));
    }
    return result;
  }
  fail("INVALID_DECK_LIST", `The ${label} must be an array or quantity map.`);
}

function cleanId(value) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function cleanName(value) {
  const name = String(value || "Player").trim().replace(/\s+/g, " ").slice(0, 30);
  return name || "Player";
}

function cleanOptionalText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function canonicalActionType(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function toInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    fail("INVALID_NUMBER", `${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function restoreGameState(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, snapshot);
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function randomChoice(values) {
  return values[crypto.randomInt(values.length)];
}

function fail(code, message, details = undefined) {
  throw new OfficialGameError(code, message, details);
}
