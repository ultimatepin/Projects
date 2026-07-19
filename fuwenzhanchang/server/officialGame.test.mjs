import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OfficialGameError,
  applyOfficialAction,
  createOfficialGame,
  serialiseOfficialGame,
  validateDeckDefinition,
} from "./officialGame.js";
import { deriveCardResourceCost, planRunePayment } from "./runePayment.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(
  fs.readFileSync(path.resolve(here, "../public/cards.json"), "utf8"),
);
const catalog = new Map(cards.map((card) => [card.id, card]));
const ZAUN_WARRENS_CARD_ID = "ogn-298-298";

function regularCards(type) {
  return cards.filter(
    (card) =>
      card.type === type &&
      !card.variant &&
      !card.is_banned &&
      card.name,
  );
}

function buildDeck() {
  const units = regularCards("Unit").slice(0, 14);
  assert.equal(units.length, 14, "test catalog needs fourteen legal Units");
  return {
    legendId: regularCards("Legend")[0].id,
    chosenChampionId: units[0].id,
    mainDeck: [...units.slice(0, 13).flatMap((card) => [card.id, card.id, card.id]), units[13].id],
    runeDeck: Array.from({ length: 12 }, () => regularCards("Rune")[0].id),
    battlefields: regularCards("Battlefield").slice(0, 3).map((card) => card.id),
  };
}

function newGame() {
  const deck = buildDeck();
  return createOfficialGame(
    [
      { id: "alice", name: "Alice", deck },
      { id: "bob", name: "Bob", deck },
    ],
    catalog,
  );
}

function act(game, playerId, type, payload = {}) {
  return applyOfficialAction(game, playerId, { type, payload }, catalog);
}

function finishMulligans(game, choices = {}) {
  act(game, "alice", "SUBMIT_MULLIGAN", {
    instanceIds: choices.alice || [],
  });
  act(game, "bob", "SUBMIT_MULLIGAN", {
    instanceIds: choices.bob || [],
  });
  return game;
}

function activePlayer(game) {
  return game.players.find((player) => player.id === game.turn.activePlayerId);
}

function opponent(game, playerId) {
  return game.players.find((player) => player.id !== playerId);
}

function playReadyUnitToBase(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const unit = player.zones.hand.find(
    (instance) => catalog.get(instance.cardId)?.type === "Unit",
  );
  assert.ok(unit, "player should have a Unit in hand");
  const cost = deriveCardResourceCost(catalog.get(unit.cardId));
  player.runePool.energy = cost.energy;
  player.runePool.powerByDomain = { ...cost.powerByDomain };
  act(game, playerId, "PLAY_CARD", {
    instanceId: unit.instanceId,
    destination: "base",
  });
  const permanent = player.zones.base.at(-1);
  act(game, playerId, "APPLY_EFFECT", {
    description: "an Accelerate-style ready effect",
    operations: [{ type: "ready", instanceId: permanent.instanceId }],
  });
  return permanent;
}

function closeShowdown(game) {
  const first = game.showdown.focusPlayerId;
  act(game, first, "PASS_FOCUS");
  const second = game.showdown.focusPlayerId;
  act(game, second, "PASS_FOCUS");
}

function prepareZaunConquer(game, player, battlefield = game.battlefields[0]) {
  battlefield.cardId = ZAUN_WARRENS_CARD_ID;
  const unit = playReadyUnitToBase(game, player.id);
  return { battlefield, unit };
}

function conquerWithUnit(game, player, battlefield, unit, { resolveTrigger = true } = {}) {
  act(game, player.id, "STANDARD_MOVE", {
    unitIds: [unit.instanceId],
    destination: battlefield.instanceId,
  });
  closeShowdown(game);
  if (resolveTrigger && game.showdown?.type === "triggered-effect") closeShowdown(game);
}

function keepOnlyHandCards(player, count) {
  const removed = player.zones.hand.splice(count);
  player.zones.trash.push(...removed);
}

test("deck validation enforces structure, copy-by-name bans, and exact-precon exception", () => {
  const deck = buildDeck();
  const validated = validateDeckDefinition(deck, catalog);
  assert.equal(validated.mainDeck.length, 40);
  assert.equal(validated.runeDeck.length, 12);
  assert.equal(validated.battlefields.length, 3);
  assert.ok(
    validated.metadataLimitations.some((message) => message.includes("Champion")),
    "current display catalog should report missing champion metadata",
  );

  const fourCopies = structuredClone(deck);
  fourCopies.mainDeck[39] = fourCopies.mainDeck[0];
  assert.throws(
    () => validateDeckDefinition(fourCopies, catalog),
    (error) => error instanceof OfficialGameError && error.code === "CARD_COPY_LIMIT",
  );

  const banned = cards.find(
    (card) => card.is_banned && ["Unit", "Gear", "Spell"].includes(card.type),
  );
  assert.ok(banned, "test catalog needs a banned Main Deck card");
  const bannedDeck = structuredClone(deck);
  bannedDeck.mainDeck[39] = banned.id;
  assert.throws(
    () => validateDeckDefinition(bannedDeck, catalog),
    (error) => error instanceof OfficialGameError && error.code === "BANNED_CARD",
  );
  bannedDeck.isExactPrecon = true;
  const precon = validateDeckDefinition(bannedDeck, catalog, { allowExactPrecon: true });
  assert.equal(precon.exactPreconDeclared, true);
});

test("setup preserves the Chosen Champion, opening hand, mulligan, and automatic first turn", () => {
  const game = newGame();
  assert.equal(game.status, "mulligan");
  for (const player of game.players) {
    assert.equal(player.zones.champion.length, 1);
    assert.equal(player.zones.hand.length, 4);
    assert.equal(player.zones.mainDeck.length, 35);
    assert.equal(player.zones.runeDeck.length, 12);
  }
  assert.equal(game.battlefields.length, 2);
  assert.notEqual(game.battlefields[0].ownerPlayerId, game.battlefields[1].ownerPlayerId);

  const aliceChoice = game.players[0].zones.hand[0].instanceId;
  finishMulligans(game, { alice: [aliceChoice] });
  assert.equal(game.status, "playing");
  assert.equal(game.turn.phase, "main");
  assert.equal(game.turn.number, 1);
  const first = activePlayer(game);
  assert.equal(first.id, game.firstPlayerId);
  assert.equal(first.zones.runes.length, 2);
  assert.equal(first.zones.runeDeck.length, 10);
  assert.equal(first.zones.hand.length, 5);
  assert.equal(first.runePool.energy, 0);

  const ownView = serialiseOfficialGame(game, first.id);
  const own = ownView.players.find((player) => player.id === first.id);
  const other = ownView.players.find((player) => player.id !== first.id);
  assert.equal(own.zones.hand.cards.length, own.zones.hand.count);
  assert.equal(other.zones.hand.cards, undefined);
  assert.deepEqual(Object.keys(own.zones.mainDeck), ["count"]);
  assert.deepEqual(Object.keys(own.zones.runeDeck), ["count"]);
});

test("PLAY_CARD derives one atomic Rune payment and rejects free or spoofed plays", () => {
  const game = finishMulligans(newGame());
  let player = activePlayer(game);
  const sourceIndex = player.zones.mainDeck.findIndex((instance) => {
    const card = catalog.get(instance.cardId);
    return card?.type === "Unit" && Number(card?.stats?.power || 0) > 0;
  });
  assert.ok(sourceIndex >= 0, "test deck needs a Unit with a Power cost");
  const [instance] = player.zones.mainDeck.splice(sourceIndex, 1);
  player.zones.hand.push(instance);
  const card = catalog.get(instance.cardId);

  player.zones.runeDeck.unshift(...player.zones.runes.splice(0));
  const unaffordableSnapshot = structuredClone(game);
  assert.throws(
    () => act(game, player.id, "PLAY_CARD", {
      instanceId: instance.instanceId,
      destination: "base",
    }),
    (error) => error instanceof OfficialGameError
      && error.code === "INSUFFICIENT_CARD_RESOURCES",
  );
  assert.deepEqual(game, unaffordableSnapshot, "an unpaid play must roll back completely");
  player = activePlayer(game);
  player.runePool.energy = 2;

  let plan = planRunePayment({
    card,
    runePool: player.runePool,
    runes: player.zones.runes,
    cardsById: catalog,
  });
  while (!plan.affordable && player.zones.runeDeck.length) {
    const rune = player.zones.runeDeck.pop();
    rune.exhausted = false;
    player.zones.runes.push(rune);
    plan = planRunePayment({
      card,
      runePool: player.runePool,
      runes: player.zones.runes,
      cardsById: catalog,
    });
  }
  assert.equal(plan.affordable, true);
  assert.ok(plan.exhaustIds.length > 0, "payment should exhaust ready Runes for Energy");
  assert.ok(plan.recycleIds.length > 0, "payment should recycle a matching Rune for Power");

  const spoofedSnapshot = structuredClone(game);
  assert.throws(
    () => act(game, player.id, "PLAY_CARD", {
      instanceId: instance.instanceId,
      destination: "base",
      spend: { energy: 0, powerByDomain: {} },
    }),
    (error) => error instanceof OfficialGameError
      && error.code === "DECLARED_COST_MISMATCH",
  );
  assert.deepEqual(game, spoofedSnapshot, "a spoofed legacy cost must not change Rune state");
  player = activePlayer(game);

  act(game, player.id, "PLAY_CARD", {
    instanceId: instance.instanceId,
    destination: "base",
  });
  assert.ok(player.zones.base.some((candidate) => candidate.instanceId === instance.instanceId));
  assert.equal(player.runePool.energy, 0);
  assert.equal(player.runePool.powerByDomain[card.faction], 0);
  for (const instanceId of plan.recycleIds) {
    assert.ok(player.zones.runeDeck.some((rune) => rune.instanceId === instanceId));
    assert.ok(!player.zones.runes.some((rune) => rune.instanceId === instanceId));
  }
  for (const instanceId of plan.exhaustIds.filter((id) => !plan.recycleIds.includes(id))) {
    assert.equal(
      player.zones.runes.find((rune) => rune.instanceId === instanceId)?.exhausted,
      true,
    );
  }
  assert.equal(game.history.at(-2)?.type, "PAY_COST");
  assert.equal(game.history.at(-2)?.data.fromPool.energy, 2);
  assert.match(game.history.at(-2)?.message || "", /used 2 Energy already in the Rune Pool/);
  assert.equal(game.history.at(-1)?.type, "PLAY_UNIT");
});

test("runes, final-point Conquer restriction, scoring, and cleanup produce an official win", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);

  const rune = player.zones.runes[0];
  act(game, player.id, "USE_RUNE", { instanceId: rune.instanceId, mode: "energy" });
  assert.equal(player.runePool.energy, 1);
  assert.equal(rune.exhausted, true);

  act(game, player.id, "APPLY_EFFECT", {
    description: "a printed effect that grants points",
    operations: [{ type: "gainPoints", playerId: player.id, count: 7 }],
  });
  assert.equal(player.score, 7);
  assert.equal(game.status, "playing");

  const firstUnit = playReadyUnitToBase(game, player.id);
  const secondUnit = playReadyUnitToBase(game, player.id);
  const handBeforeFirstConquer = player.zones.hand.length;

  act(game, player.id, "STANDARD_MOVE", {
    unitIds: [firstUnit.instanceId],
    destination: game.battlefields[0].instanceId,
  });
  closeShowdown(game);
  assert.equal(player.score, 7, "first Conquer cannot grant the final point");
  assert.equal(player.zones.hand.length, handBeforeFirstConquer + 1);
  assert.equal(game.battlefields[0].controllerPlayerId, player.id);

  act(game, player.id, "STANDARD_MOVE", {
    unitIds: [secondUnit.instanceId],
    destination: game.battlefields[1].instanceId,
  });
  closeShowdown(game);
  assert.equal(player.score, 8);
  assert.equal(game.status, "finished");
  assert.equal(game.winnerPlayerId, player.id);
  assert.equal(game.result.reason, "victory-score-cleanup");
  assert.equal(rival.score, 0);
});

test("Zaun Warrens creates a private server-authoritative discard choice and resolves atomically", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);
  const { battlefield, unit } = prepareZaunConquer(game, player);
  const handBefore = player.zones.hand.length;
  const deckBefore = player.zones.mainDeck.length;

  conquerWithUnit(game, player, battlefield, unit);

  assert.equal(battlefield.controllerPlayerId, player.id);
  assert.equal(player.score, 1);
  assert.equal(player.zones.hand.length, handBefore, "the server must wait for the discard choice");
  assert.equal(player.zones.mainDeck.length, deckBefore, "the follow-up draw must not happen early");
  assert.ok(game.pendingDecision);
  assert.equal(game.pendingDecision.kind, "card-selection");
  assert.equal(game.pendingDecision.playerId, player.id);
  assert.equal(game.pendingDecision.source.cardId, ZAUN_WARRENS_CARD_ID);
  assert.equal(game.pendingDecision.selection.operation, "discard");
  assert.deepEqual(
    new Set(game.pendingDecision.selection.eligibleInstanceIds),
    new Set(player.zones.hand.map((card) => card.instanceId)),
  );

  const ownView = serialiseOfficialGame(game, player.id);
  const rivalView = serialiseOfficialGame(game, rival.id);
  assert.equal(ownView.pendingDecision.id, game.pendingDecision.id);
  assert.deepEqual(rivalView.pendingDecision, {
    playerId: player.id,
    kind: "card-selection",
  });

  const decisionId = game.pendingDecision.id;
  const discarded = player.zones.hand[0];
  act(game, player.id, "RESOLVE_PENDING_DECISION", {
    decisionId,
    instanceIds: [discarded.instanceId],
  });

  assert.equal(game.pendingDecision, null);
  assert.equal(player.zones.hand.length, handBefore, "discard 1 then draw 1 preserves hand size");
  assert.equal(player.zones.mainDeck.length, deckBefore - 1);
  assert.ok(player.zones.trash.some((card) => card.instanceId === discarded.instanceId));
  assert.ok(game.history.some((entry) => entry.type === "DISCARD"));
  assert.ok(
    game.history.some(
      (entry) => entry.type === "CARD_EFFECT" && entry.data.sourceCardId === ZAUN_WARRENS_CARD_ID,
    ),
  );
});

test("Zaun Warrens enters a Focus response window before resolving its Conquer trigger", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);
  const { battlefield, unit } = prepareZaunConquer(game, player);
  const handBefore = player.zones.hand.length;

  conquerWithUnit(game, player, battlefield, unit, { resolveTrigger: false });

  assert.equal(game.showdown?.type, "triggered-effect");
  assert.equal(game.showdown?.pendingEffect?.kind, "zaun-warrens-conquer");
  assert.equal(game.showdown?.focusPlayerId, player.id);
  assert.equal(game.pendingDecision, null);
  assert.equal(player.zones.hand.length, handBefore);

  act(game, player.id, "PASS_FOCUS");
  assert.equal(game.showdown?.focusPlayerId, rival.id);
  assert.equal(game.pendingDecision, null);
  act(game, rival.id, "PASS_FOCUS");

  assert.equal(game.showdown, null);
  assert.ok(game.pendingDecision, "the discard choice begins only after both players pass");
  assert.equal(game.pendingDecision.playerId, player.id);
});

test("a nested battlefield response resolves before the Zaun trigger window resumes", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);
  const responseUnit = playReadyUnitToBase(game, player.id);
  const { battlefield, unit } = prepareZaunConquer(game, player);

  conquerWithUnit(game, player, battlefield, unit, { resolveTrigger: false });
  assert.equal(game.showdown?.type, "triggered-effect");
  act(game, player.id, "PASS_FOCUS");
  assert.equal(game.showdown?.focusPlayerId, rival.id);
  assert.equal(game.showdown?.consecutivePasses, 1);

  act(game, rival.id, "APPLY_EFFECT", {
    description: "a printed move response that contests the other battlefield",
    operations: [{
      type: "move",
      instanceId: responseUnit.instanceId,
      destination: game.battlefields[1].instanceId,
    }],
  });

  assert.equal(game.showdown?.type, "non-combat");
  assert.equal(game.suspendedWindows.length, 1);
  assert.equal(game.suspendedWindows[0].showdown.type, "triggered-effect");
  assert.equal(game.suspendedWindows[0].showdown.focusPlayerId, player.id);
  assert.equal(game.suspendedWindows[0].showdown.consecutivePasses, 0);

  closeShowdown(game);
  assert.equal(game.suspendedWindows.length, 0);
  assert.equal(game.showdown?.type, "triggered-effect");
  assert.equal(game.showdown?.pendingEffect?.kind, "zaun-warrens-conquer");
  assert.equal(
    game.showdown?.focusPlayerId,
    player.id,
    "the response action passes Focus before the original window resumes",
  );
  assert.equal(game.showdown?.consecutivePasses, 0);

  closeShowdown(game);
  assert.equal(game.showdown, null);
  assert.ok(game.pendingDecision);
  assert.equal(game.pendingDecision.playerId, player.id);
});

test("pending Zaun choices reject wrong, stale, invalid, and unrelated actions without mutation", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);
  const { battlefield, unit } = prepareZaunConquer(game, player);
  conquerWithUnit(game, player, battlefield, unit);
  const decisionId = game.pendingDecision.id;
  const validId = game.pendingDecision.selection.eligibleInstanceIds[0];

  function expectRollback(run, code) {
    const before = JSON.stringify(game);
    assert.throws(
      run,
      (error) => error instanceof OfficialGameError && error.code === code,
    );
    assert.equal(JSON.stringify(game), before);
  }

  expectRollback(
    () => act(game, rival.id, "RESOLVE_PENDING_DECISION", {
      decisionId,
      instanceIds: [validId],
    }),
    "NOT_YOUR_PENDING_DECISION",
  );
  expectRollback(
    () => act(game, player.id, "RESOLVE_PENDING_DECISION", {
      decisionId: "stale-decision",
      instanceIds: [validId],
    }),
    "STALE_PENDING_DECISION",
  );
  expectRollback(
    () => act(game, player.id, "RESOLVE_PENDING_DECISION", {
      decisionId,
      instanceIds: [game.players.find((candidate) => candidate.id === player.id).zones.runes[0].instanceId],
    }),
    "INVALID_PENDING_SELECTION",
  );
  expectRollback(
    () => act(game, player.id, "END_TURN"),
    "PENDING_DECISION_REQUIRED",
  );

  act(game, player.id, "RESOLVE_PENDING_DECISION", {
    decisionId,
    instanceIds: [validId],
  });
  assert.throws(
    () => act(game, player.id, "RESOLVE_PENDING_DECISION", {
      decisionId,
      instanceIds: [validId],
    }),
    (error) => error instanceof OfficialGameError && error.code === "NO_PENDING_DECISION",
  );
});

test("either player may concede while a Zaun Warrens choice is pending", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);
  const { battlefield, unit } = prepareZaunConquer(game, player);
  conquerWithUnit(game, player, battlefield, unit);
  assert.ok(game.pendingDecision);

  act(game, rival.id, "CONCEDE");

  assert.equal(game.pendingDecision, null);
  assert.equal(game.status, "finished");
  assert.equal(game.winnerPlayerId, player.id);
  assert.equal(game.result.reason, "concession");
});

test("Zaun Warrens auto-resolves when discard has zero or one possible card", () => {
  for (const retainedCards of [0, 1]) {
    const game = finishMulligans(newGame());
    const player = activePlayer(game);
    const { battlefield, unit } = prepareZaunConquer(game, player);
    keepOnlyHandCards(player, retainedCards);
    const discardedId = player.zones.hand[0]?.instanceId || null;
    const deckBefore = player.zones.mainDeck.length;
    const trashBefore = player.zones.trash.length;

    conquerWithUnit(game, player, battlefield, unit);

    assert.equal(game.pendingDecision, null);
    assert.equal(player.zones.hand.length, 1);
    assert.equal(player.zones.mainDeck.length, deckBefore - 1);
    assert.equal(
      player.zones.trash.length,
      trashBefore + (discardedId ? 1 : 0),
    );
    if (discardedId) {
      assert.ok(player.zones.trash.some((card) => card.instanceId === discardedId));
    }
  }
});

test("Zaun Warrens still triggers after final-point replacement draw", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const { battlefield, unit } = prepareZaunConquer(game, player);
  player.score = 7;
  const handBefore = player.zones.hand.length;
  const deckBefore = player.zones.mainDeck.length;

  conquerWithUnit(game, player, battlefield, unit);

  assert.equal(player.score, 7);
  assert.equal(player.zones.hand.length, handBefore + 1, "the final-point replacement draws first");
  assert.equal(player.zones.mainDeck.length, deckBefore - 1);
  assert.ok(game.pendingDecision, "the Conquer effect triggers even when its point was replaced");

  act(game, player.id, "RESOLVE_PENDING_DECISION", {
    decisionId: game.pendingDecision.id,
    instanceIds: [player.zones.hand[0].instanceId],
  });
  assert.equal(player.zones.hand.length, handBefore + 1);
  assert.equal(player.zones.mainDeck.length, deckBefore - 2);
  assert.equal(game.status, "playing");
});

test("victory cleanup waits for a pending Zaun Warrens effect", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const { battlefield, unit } = prepareZaunConquer(game, player);
  player.score = 7;
  for (const other of game.battlefields) {
    if (other !== battlefield) other.scoredTurnByPlayer[player.id] = game.turn.number;
  }

  conquerWithUnit(game, player, battlefield, unit);

  assert.equal(player.score, 8);
  assert.equal(game.status, "playing");
  assert.ok(game.pendingDecision);
  act(game, player.id, "RESOLVE_PENDING_DECISION", {
    decisionId: game.pendingDecision.id,
    instanceIds: [player.zones.hand[0].instanceId],
  });
  assert.equal(game.pendingDecision, null);
  assert.equal(game.status, "finished");
  assert.equal(game.winnerPlayerId, player.id);
  assert.equal(game.result.reason, "victory-score-cleanup");
});

test("combat assigns current Might, deals simultaneously, kills, heals, recalls, and updates control", () => {
  const game = finishMulligans(newGame());
  const defender = activePlayer(game);
  const battlefield = game.battlefields[0];
  const defenderUnit = playReadyUnitToBase(game, defender.id);
  act(game, defender.id, "STANDARD_MOVE", {
    unitIds: [defenderUnit.instanceId],
    destination: battlefield.instanceId,
  });
  closeShowdown(game);
  assert.equal(battlefield.controllerPlayerId, defender.id);

  act(game, defender.id, "END_TURN");
  const attacker = activePlayer(game);
  assert.notEqual(attacker.id, defender.id);
  assert.equal(attacker.zones.runes.length, 3, "second player channels an extra first-turn rune");
  const attackerUnit = playReadyUnitToBase(game, attacker.id);
  act(game, attacker.id, "STANDARD_MOVE", {
    unitIds: [attackerUnit.instanceId],
    destination: battlefield.instanceId,
  });
  assert.equal(game.showdown.type, "combat");
  closeShowdown(game);
  assert.equal(game.combat.stage, "assign-attacker");

  const attackerTotal = game.combat.mightTotals[attacker.id];
  const defenderTotal = game.combat.mightTotals[defender.id];
  act(game, attacker.id, "ASSIGN_COMBAT_DAMAGE", {
    allocations: [{ instanceId: defenderUnit.instanceId, amount: attackerTotal }],
  });
  assert.equal(game.combat.stage, "assign-defender");
  act(game, defender.id, "ASSIGN_COMBAT_DAMAGE", {
    allocations: [{ instanceId: attackerUnit.instanceId, amount: defenderTotal }],
  });

  assert.equal(game.combat, null);
  assert.equal(game.showdown, null);
  assert.equal(game.turn.phase, "main");
  for (const card of battlefield.cards) assert.equal(card.damage, 0);
  for (const participant of game.players) {
    for (const card of participant.zones.base) assert.equal(card.damage, 0);
  }
  assert.ok(
    game.history.some((entry) => entry.type === "COMBAT_RESOLVED"),
    "combat resolution should be auditable",
  );
});

test("empty-deck burnout repeats safely and awards the opponent the game", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const rival = opponent(game, player.id);
  assert.equal(player.zones.trash.length, 0);

  act(game, player.id, "APPLY_EFFECT", {
    description: "an oversized draw",
    operations: [{ type: "draw", playerId: player.id, count: 40 }],
  });
  assert.equal(game.status, "finished");
  assert.equal(game.winnerPlayerId, rival.id);
  assert.equal(rival.score, 8);
  assert.equal(game.result.reason, "sequential-burnout");
  assert.equal(
    game.history.filter((entry) => entry.type === "BURNOUT").length,
    8,
  );
});

test("a rejected multi-operation effect rolls back the whole server action", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  assert.equal(player.score, 0);
  assert.throws(
    () =>
      act(game, player.id, "APPLY_EFFECT", {
        description: "an invalid partial effect",
        operations: [
          { type: "gainPoints", playerId: player.id, count: 3 },
          { type: "arbitraryCounterEdit", amount: 999 },
        ],
      }),
    (error) =>
      error instanceof OfficialGameError && error.code === "UNSAFE_MANUAL_OPERATION",
  );
  assert.equal(
    game.players.find((candidate) => candidate.id === player.id).score,
    0,
  );
});

test("manual XP operations gain and spend the public player resource atomically", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);

  act(game, player.id, "APPLY_EFFECT", {
    description: "Hunt 5, then spend 2 XP",
    operations: [
      { type: "gain_xp", playerId: player.id, count: 5 },
      { type: "spend_xp", playerId: player.id, count: 2 },
    ],
  });
  assert.equal(player.xp, 3);
  assert.equal(
    serialiseOfficialGame(game, opponent(game, player.id).id)
      .players.find((candidate) => candidate.id === player.id).xp,
    3,
    "XP is public information",
  );

  assert.throws(
    () => act(game, player.id, "APPLY_EFFECT", {
      description: "an unaffordable XP cost",
      operations: [{ type: "spend_xp", playerId: player.id, count: 4 }],
    }),
    (error) => error instanceof OfficialGameError && error.code === "INSUFFICIENT_XP",
  );
  assert.equal(player.xp, 3, "a rejected XP spend must not alter game state");
});

test("CREATE_TOKEN accepts only official token records and tokens cease outside the board", () => {
  const game = finishMulligans(newGame());
  const player = activePlayer(game);
  const battlefield = game.battlefields[0];

  act(game, player.id, "APPLY_EFFECT", {
    description: "play a ready Bird token here",
    operations: [{
      type: "create_token",
      cardId: "unl-t02",
      playerId: player.id,
      destination: battlefield.instanceId,
      exhausted: false,
    }],
  });
  const bird = battlefield.cards.find((card) => card.cardId === "unl-t02");
  assert.ok(bird);
  assert.equal(bird.token, true);
  assert.equal(bird.ownerPlayerId, player.id);
  assert.equal(bird.controllerPlayerId, player.id);
  assert.equal(bird.exhausted, false);
  assert.equal(
    serialiseOfficialGame(game, player.id).battlefields[0].cards
      .find((card) => card.instanceId === bird.instanceId).token,
    true,
  );

  closeShowdown(game);
  act(game, player.id, "APPLY_EFFECT", {
    description: "kill the Bird token",
    operations: [{ type: "kill", instanceId: bird.instanceId }],
  });
  assert.equal(battlefield.cards.some((card) => card.instanceId === bird.instanceId), false);
  assert.equal(player.zones.trash.some((card) => card.instanceId === bird.instanceId), false);

  act(game, player.id, "APPLY_EFFECT", {
    description: "play an exhausted Gold token",
    operations: [{
      type: "create_token",
      cardId: "sfd-t03",
      playerId: player.id,
      destination: "base",
      exhausted: true,
      count: 2,
    }],
  });
  const gold = player.zones.base.filter((card) => card.cardId === "sfd-t03");
  assert.equal(gold.length, 2);
  assert.ok(gold.every((card) => card.token && card.exhausted));

  assert.throws(
    () => act(game, player.id, "APPLY_EFFECT", {
      description: "not a token",
      operations: [{
        type: "create_token",
        cardId: buildDeck().mainDeck[0],
        playerId: player.id,
        destination: "base",
      }],
    }),
    (error) => error instanceof OfficialGameError && error.code === "INVALID_TOKEN_CARD",
  );
  assert.equal(player.zones.base.filter((card) => card.cardId === "sfd-t03").length, 2);
});
