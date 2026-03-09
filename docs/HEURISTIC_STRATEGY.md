# Skip-Bo Optimal Play: Strategy Analysis & Decision Trees

## 1. Overview

This document maps out every decision point in a Skip-Bo game, the information available
at each point, and the optimal reasoning process. The goal is to create a complete
decision framework that an AI can use — not as hard-coded heuristics, but as a reference
for what "correct play" looks like. The AI should arrive at these same conclusions through
evaluation and search.

---

## 2. Information Model

### What You Know (Perfect Information)

- Your hand (5 cards, values visible)
- Your stockpile top card (1 card visible)
- Your stockpile count
- Your 4 discard piles (ALL cards in each pile visible, not just tops)
- All 4 building piles (complete card sequences visible)
- ALL opponents' discard piles (complete contents visible)
- ALL opponents' stockpile top cards
- ALL opponents' stockpile counts
- ALL opponents' hand sizes (count only, not values)
- Deck count (how many cards remain)

### What You Don't Know (Hidden Information)

- Opponent hand card VALUES (you only see the count)
- Deck card order and composition
- Your stockpile cards below the top
- Opponent stockpile cards below the top

### What You Can Compute (Card Counting)

From visible information, for any value V:

```
total_copies(V) = 12   (or 18 for SKIP-BO)
visible_copies(V) = count in: building piles + all hands(own) + all discard piles + all stock tops
remaining(V) = total_copies(V) - visible_copies(V)
unknown_pool = deck_count + sum(opponent_hand_sizes) + sum(hidden_stockpile_cards)
P(V in deck) ≈ remaining(V) × deck_count / unknown_pool
```

### Information Gained Each Turn

- When you draw: you see new cards (reduces unknown pool)
- When opponent discards: you see what they chose to discard (inference about hand)
- When opponent plays: you see what they chose to play (inference about strategy)
- When opponent does NOT play a matching card: they likely don't have it
- When a building pile completes (reaches 12): those cards return to deck (randomized)

---

## 3. Full Turn Decision Tree

```
YOUR TURN BEGINS
│
├─ Draw to 5 cards (automatic)
│  └─ Information update: you now see up to 5 new cards
│
├─ ASSESS POSITION
│  ├─ What does my stockpile top need?
│  ├─ What do building piles currently need? [4 values, 1-12 or null]
│  ├─ What chains exist from my current state?
│  ├─ What is opponent's stockpile top? How close are piles to it?
│  └─ Card count: what values are scarce/plentiful?
│
├─ PLAY PHASE (loop until you choose to stop or no moves exist)
│  │
│  ├─── DECISION 1: Can I play my stockpile?
│  │    ├─ YES → ALWAYS PLAY IT (see §4.1 for pile selection)
│  │    │   └─ After playing: new stockpile top revealed → reassess → loop
│  │    └─ NO → continue to Decision 2
│  │
│  ├─── DECISION 2: What non-stockpile plays are available?
│  │    │  Enumerate ALL possible plays:
│  │    │  ├─ Hand number cards matching any pile's needed value
│  │    │  ├─ Hand SKIP-BO on any non-complete pile
│  │    │  ├─ Discard pile tops matching any pile's needed value
│  │    │  └─ Discard pile SKIP-BO tops on any non-complete pile
│  │    │
│  │    ├─ ZERO plays available → go to DISCARD PHASE
│  │    │
│  │    └─ ONE OR MORE plays available → DECISION 3
│  │
│  ├─── DECISION 3: Should I play anything, or stop and discard?
│  │    │
│  │    │  Evaluate: "Is the BEST available play better than holding?"
│  │    │
│  │    │  REASONS TO PLAY:
│  │    │  ├─ Play enables a chain that reaches stockpile play
│  │    │  ├─ Play empties hand → draw 5 fresh cards (cycling)
│  │    │  ├─ Play advances a pile I need advanced (toward my stock value)
│  │    │  ├─ Play uses a card I don't need (freeing hand space)
│  │    │  └─ Play reveals a useful discard card underneath
│  │    │
│  │    │  REASONS TO STOP:
│  │    │  ├─ Every available play advances piles toward OPPONENT's stock value
│  │    │  ├─ Hand contains cards forming a chain for NEXT turn
│  │    │  ├─ Only SKIP-BO is playable and no chain results (waste of wildcard)
│  │    │  ├─ Discard play would expose a card opponent needs
│  │    │  └─ Current hand + discard structure is already well-positioned
│  │    │
│  │    ├─ PLAY → go to DECISION 4
│  │    └─ STOP → go to DISCARD PHASE
│  │
│  ├─── DECISION 4: Which card to play and where?
│  │    │
│  │    │  For each candidate play, compute:
│  │    │
│  │    │  CHAIN VALUE:
│  │    │  ├─ How many follow-up plays does this enable?
│  │    │  ├─ Does the chain reach a stockpile play? (+100)
│  │    │  ├─ Does the chain empty my hand? (cycling value)
│  │    │  └─ What cards are revealed from discards during chain?
│  │    │
│  │    │  PILE IMPACT:
│  │    │  ├─ Does this pile advance toward my stockpile value? (+)
│  │    │  ├─ Does this pile advance toward opponent's stockpile value? (-)
│  │    │  ├─ Does completing this pile (reaching 12) help or hurt?
│  │    │  └─ Are there duplicate discard values at the next-needed value? (+)
│  │    │
│  │    │  CARD COST:
│  │    │  ├─ SKIP-BO: expensive (only 18 in deck, very flexible)
│  │    │  ├─ Scarce value: expensive (few remaining copies)
│  │    │  ├─ Card I need for future chain: expensive
│  │    │  └─ Card with no future use: cheap
│  │    │
│  │    │  NET VALUE = chain_value + pile_impact - card_cost
│  │    │
│  │    ├─ Play the card with highest NET VALUE
│  │    └─ After playing: check hand refill, check new stockpile → loop back
│  │
│  └─── (Hand emptied → auto-draw 5 → loop back to Decision 1)
│
├─ DISCARD PHASE
│  │
│  ├─── DECISION 5: Which card to discard? (see §4.6)
│  │
│  └─── DECISION 6: Which discard pile to place it on? (see §4.7)
│
└─ END TURN
```

---

## 4. Deep Dive: Each Decision

### 4.1 Stockpile Play: Pile Selection

When stockpile can be played, it MUST be played IMMEDIATELY (it's the win condition).
Never delay a stockpile play to "set up" with other cards first — play it the instant
it's valid. After playing, a new stockpile card is revealed, which may unlock more plays.

**Stockpile plays are immune to blocking** — with two narrow exceptions:

1. **Opponent has ≤3 stockpile cards remaining** AND your play would directly set up
   their winning move. Only then does blocking outweigh your own progress.
2. **Early game low-value stockpile (1-2)** where playing it would advance a pile into
   the opponent's immediate danger zone (e.g., your stockpile 1 on an empty pile → pile
   needs 2, opponent stockpile is 3 and has a 2 visible). Deferring until you can bridge
   past the danger zone or until the opponent draws those cards naturally is acceptable.
   This exception fades quickly — once multiple piles are active, the marginal danger of
   one pile advancing is low.

In all other cases, play stockpile unconditionally. Never hold back a stockpile play
"because it helps the opponent" — your progress is worth more.

The only question is WHERE when the stockpile top is SKIP-BO or multiple piles match.

**SKIP-BO from stockpile — pile selection:**

```
For each building pile P (that isn't complete):
│
├── Compute: what value does P need? (call it N)
│   After placing SKIP-BO, P will need N+1 (or 1 if N=12)
│
├── Chain check: starting from N+1, how long a chain can I play?
│   ├── Is N+1 in my hand?
│   ├── Is N+1 on any discard top?
│   ├── If I play N+1, is N+2 available? (recurse)
│   └── Does this chain reach another stockpile play?
│
├── Opponent check: compute effective danger distance (see §7.2)
│   │  after placing SKIP-BO on this pile, what is the effective distance
│   │  from the pile's new needed value to opponent's stockpile?
│   ├── effective_distance = 0 → CRITICAL (opponent can reach stock immediately)
│   ├── effective_distance ≤ 2 → DANGER ZONE (one or two draws away)
│   └── effective_distance > 2 → safe
│
└── Score = chain_length × 10
          + reaches_stockpile × 100
          - opponent_proximity × 30
          + pile_completion_bonus (if chain completes pile)

Play on pile with highest score.
```

**NEXT-STOCKPILE REACHABILITY (critical for SKIP-BO stockpile):**

When you play a stockpile card, a NEW stockpile card is revealed. The value of your
current play includes not just the immediate chain, but how many of the 12 possible
next-stockpile values become playable as a result.

```
For each candidate pile P to place SKIP-BO stockpile:
│
├── Simulate: after placing SKIP-BO on P, for each value V (1-12):
│   └── Can I chain from current hand + discard tops to reach V on ANY building pile?
│       ├── Count building piles where V is reachable
│       └── Consider: hand cards, discard pile tops, and chains through discards
│
├── COVERAGE = count of reachable V values / 12
│   └── Higher coverage = more likely to play the next stockpile card immediately
│
└── Choose placement that MAXIMIZES coverage
    (not just longest immediate chain!)
```

**Why this matters more than chain length:**
The goal of Skip-Bo is emptying your stockpile. A placement that enables 8 plays but
only covers 7/12 next values is WORSE than one that enables 3 plays but covers 10/12
next values — because the 3-play option has 83% chance of continuing to empty stockpile
cards, while the 8-play option only has 58% chance.

**Worked example:**
SKIP-BO stockpile, building piles need [6, 1, 1, 3], hand [7,9,7,9],
d1=[7,7,6](top=6), d2=[3,2](top=2), d4=[12,10,10,9,8](top=8)

SKIP-BO as 1 on empty pile: covers 1,2,3,4,6,7,8,9,10,11 = 10/12 (83%)
SKIP-BO as 6 on pile 1: covers 1,3,7,8,9,10,11 = 7/12 (58%)

The as-1 placement opens pile 2 AND preserves pile 1's runway through d1,
giving reach across almost the entire value range. The as-6 placement
strands d1's 6, blocks d2's 2→3 chain, and wastes the 6-value slot.

**This principle applies to ALL stockpile plays, not just SKIP-BO:**
Whenever you have a choice of which building pile to play your stockpile on
(e.g., two piles need the same value after a reset), prefer the pile that
maximizes next-stockpile reachability.

**Numbered card from stockpile — pile selection:**
Usually only one pile matches. If a value matches two piles (after one completed and reset),
choose the pile where the advancement is less helpful to opponents AND where
next-stockpile reachability is highest (see above).

### 4.2 Hand Card Plays: The Chain Analysis

For every hand card that matches a building pile need:

```
Should I play hand card C on pile P?
│
├── CHAIN ANALYSIS (simulate forward):
│   ├── After C on P, pile needs C+1 (or 1 if C=12)
│   ├── Can anything play C+1?
│   │   ├── Stockpile top = C+1 → STOCKPILE PLAY! (very high value)
│   │   ├── Hand card = C+1 → chain continues
│   │   ├── Discard top = C+1 → chain continues (reveals card beneath)
│   │   └── Nothing matches → chain ends here
│   ├── Continue simulating until chain ends
│   └── Record: total plays, stockpile plays, cards cycled, discards revealed
│
├── OPPORTUNITY COST (what do I lose by playing C?):
│   ├── Will I need C for a better chain later this turn? (play order matters!)
│   ├── Is C part of a chain I'm building in my discard piles?
│   ├── Is C scarce? (few copies remaining → harder to get back)
│   ├── Is C a blocking value? (near opponent's stockpile value)
│   └── Does playing C remove it from a "held set" of same-value cards?
│
├── PILE ADVANCEMENT IMPACT:
│   ├── Does advancing P help me? (P moving toward my stock value)
│   ├── Does advancing P help opponent? (P moving toward their stock value)
│   │   ├── If pile value after chain is within 2 of opponent stock → penalty
│   │   └── If pile value after chain EQUALS opponent stock → severe penalty
│   └── Does chain complete P? (12 cards → shuffled back to deck, pile resets)
│       └── Completion is neutral: helps both players equally (new 1-start pile)
│
├── CYCLING VALUE:
│   ├── If playing C (and its chain) would empty my hand → I draw 5 new cards
│   ├── Value of cycling = P(new hand enables stockpile play)
│   │   Approximation: based on card counting, what values do I need?
│   │   How many copies remain? (see probability table §5)
│   └── Cycling is MORE valuable when:
│       ├── Current hand is poor (no useful cards after this play)
│       ├── Deck is large (more draw diversity)
│       └── Many copies of needed values remain unseen
│
└── DECISION:
    ├── NET VALUE > 0 → play this card
    ├── NET VALUE ≤ 0 → skip this card (consider other plays or stop)
    └── Compare all candidate plays, choose highest NET VALUE
```

### 4.3 Play Order Matters

Given hand [3, 4, 7] and piles needing [3, 7, 10, 1]:

**Order A**: Play 3 on pile 0 → pile 0 now needs 4 → play 4 on pile 0 → pile 0 now needs 5
Result: 2 cards played, 3 remain in hand, pile 0 advanced by 2

**Order B**: Play 7 on pile 1 → pile 1 now needs 8 → play 3 on pile 0 → needs 4 → play 4 → needs 5
Result: 3 cards played, 2 remain in hand, piles 0+1 advanced

**Order C**: Play 3, then 4, then 7 → same as B but different pile advancement order
If pile 1 advancing to 8 is dangerous (opponent needs 8), then Order A is better.

**Principle**: always simulate ALL orderings of plays to find the sequence that
maximizes net value. With 3-5 playable cards this is manageable (≤120 permutations).

**STOCKPILE-FIRST PRINCIPLE:**

The goal of every turn is to play as many stockpile cards as possible. Cycling,
chains, and discard pile management are means to that end — not goals in
themselves.

Cards held to advance a building pile toward the stockpile value should be
played before cards on unrelated piles. After the stockpile card is played,
the next stockpile card is revealed — remaining plays can then be informed
by what the new stockpile needs.

```
Example: Stockpile=7, Pile A needs 5, Pile B needs 3, Hand: [3, 5, 6]

WRONG:  play 3→B, then 5→A, 6→A, stock 7→A
RIGHT:  play 5→A, 6→A, stock 7→A, then 3→B (if still useful)

Why: After stock 7→A the next stockpile card is revealed.
If the new stockpile top is 3, we wasted our only 3 on pile B.
Playing the stockpile first lets us use remaining cards with
full knowledge of what the new stockpile needs.
```

This includes uncovering plays: if a discard pile top blocks a card needed
for the stockpile advance, playing that top card first is part of advancing
toward the stockpile — even though the top card itself goes on an unrelated
building pile.

Playing unrelated cards before the stockpile is wasteful because:

- They spend cards that might match the next (unknown) stockpile value
- They advance building piles that might help opponents, with no stockpile
  benefit in return
- They delay information about the next stockpile card

### 4.4 SKIP-BO from Hand: When to Play vs Hold

SKIP-BO cards are the scarcest strategic resource (18/162 = 11.1%).

```
Should I play a SKIP-BO from my hand?
│
├── Does it enable a stockpile play (directly or through chain)?
│   └── YES → almost always play (unless saving it yields MORE stockpile plays later)
│
├── Does it enable a long chain (≥3 plays)?
│   ├── YES, and chain doesn't help opponent → play
│   ├── YES, but chain advances toward opponent's stock → weigh carefully
│   └── NO → probably hold
│
├── Does it empty my hand (cycling)?
│   ├── YES, and cycling is +EV → play
│   └── NO → weaker reason to play
│
├── Is the current position desperate? (opponent close to winning)
│   └── YES → play more aggressively with SKIP-BO (need to catch up)
│
├── How many SKIP-BOs do I have?
│   ├── 2+ in hand → can afford to use one
│   └── 1 in hand → save unless chain value is very high
│
└── DEFAULT: hold SKIP-BO unless chain value clearly justifies the cost
```

### 4.5 Discard Pile Plays: Chain-Gated with Hidden Card Bonus

Playing from discard piles is special because:

1. You can only play the TOP card
2. Playing the top REVEALS the card underneath (new information + new play option)
3. The revealed card might enable further plays

```
Should I play discard pile D's top card T?
│
├── Does T enable a stockpile play?
│   └── YES → play it (even without chain — stockpile play is the goal)
│
├── Does playing T reveal a card R underneath that:
│   ├── Enables a chain? (R matches a pile need after T is played)
│   │   └── Follow-up chain from R is very valuable
│   ├── Is useful for future turns? (R is a needed value)
│   │   └── Moderate value: frees up a previously buried card
│   └── Is unknown? (didn't track pile contents)
│       └── Uncertain value: could be great or useless
│
├── What if T is a SKIP-BO on a discard pile?
│   └── Same analysis as §4.4 but with added reveal bonus
│
├── Does playing T (without chain) just help the opponent?
│   ├── T advances a pile toward opponent stock → DON'T play
│   └── T advances a safe pile → consider based on reveal value
│
├── SOURCE SELECTION: Same card playable from hand AND/OR multiple discard piles?
│   │
│   │  HAND vs DISCARD SOURCE:
│   │  When the same value is playable from both hand and a discard pile, the default
│   │  is to prefer hand (consuming hand cards = closer to cycling/redraw). However,
│   │  this default is OVERRIDDEN when the discard pile has a chain-enabling card
│   │  underneath.
│   │
│   │  Decision: before choosing source, CHECK what's under the discard pile top.
│   │  ├── Card underneath extends the current chain → play from DISCARD (chain value
│   │  │   outweighs cycling benefit). Example: 10 in hand AND on discard with 11
│   │  │   underneath → play 10 from discard → reveals 11 → play 11 → stockpile 12.
│   │  │   Playing from hand would leave the 11 buried and miss the stockpile play.
│   │  ├── Card underneath is not useful → play from HAND (cycling benefit wins)
│   │  └── Discard pile has only 1 card (nothing underneath) → play from HAND
│   │
│   │  MULTIPLE DISCARD PILES:
│   │  When the same value appears on top of two or more discard piles, the choice
│   │  of WHICH pile to play from matters significantly.
│   │
│   ├── Prefer the MESSIER pile (structural repair)
│   │   ├── Playing from a messy pile cleans it up — restores future chain potential
│   │   ├── Playing from a clean pile wastes its existing structure for no benefit
│   │   └── Example: 6 on top of [5, 9, 6] vs 6 on top of [7, 7, 6]
│   │       ├── Play from pile [5,9,6]: reveals 9, cleans up the messy pile
│   │       └── Play from pile [7,7,6]: breaks clean layered structure needlessly
│   │
│   ├── Consider what's revealed underneath
│   │   ├── Messy pile reveals a card that might also be playable (bonus cleanup)
│   │   └── Clean pile reveals a card that was already well-positioned
│   │
│   └── This preference should be scored as a tiebreaker/bonus in chain evaluation:
│       same chain value, but discard source from messy pile gets a "repair bonus"
│
└── CURRENT AI COMPARISON:
    Current: only plays discard if immediate follow-up exists (1-step lookahead)
    Optimal: evaluate full chain including revealed cards, multi-step lookahead
    Gap: AI treats all sources of the same card as equivalent — no discard source preference
```

### 4.6 Discard Card Selection: What to Throw Away

At end of turn, you MUST discard one card from hand. Never SKIP-BO.

```
Which card to discard?
│
├── For each non-SKIP-BO card C in hand, compute HOLD VALUE:
│
│   IMMEDIATE UTILITY:
│   ├── Does C match any building pile's current need?
│   │   └── If yes: should have played it! (unless §4.2 decided not to)
│   │       Hold value: HIGH (you're deliberately keeping it for a reason)
│   │
│   ├── Does C match a pile need that's 1-2 steps away?
│   │   └── C = pile_needs + 1 or +2 → will be playable soon
│   │       Hold value: MEDIUM-HIGH
│   │
│   └── Does C match no pile within 3 steps?
│       └── C is far from any pile need → low immediate utility
│           Hold value: LOW
│
│   FUTURE CHAIN VALUE:
│   ├── Does C connect to my discard pile structure?
│   │   └── C = discard_top - 1 on some pile → potential descending chain
│   │       Hold value: MEDIUM
│   │
│   ├── Is C between a pile's current need and my stockpile value?
│   │   └── C is on the "path" to playing stockpile
│   │       Hold value: HIGH
│   │
│   └── Is C part of a multi-card sequence in hand?
│       └── Hand has [C, C+1, C+2] → potential chain
│           Hold value: MEDIUM-HIGH
│
│   SCARCITY:
│   ├── How many copies of C remain unseen? (card counting)
│   │   ├── 10+ remaining → plentiful, low scarcity cost
│   │   ├── 5-9 remaining → moderate
│   │   └── 1-4 remaining → scarce, high cost to discard
│   │       (discarding a scarce card you'll need later = very expensive)
│   │
│   └── Is C a SKIP-BO? → NEVER discard (hold value: MAXIMUM)
│
│   BLOCKING VALUE:
│   ├── Is C = opponent_stockpile_value?
│   │   └── Holding removes one copy from circulation → blocks opponent
│   │       Hold value: +bonus
│   │
│   ├── Is C = opponent_stockpile_value - 1?
│   │   └── Holding prevents pile from reaching opponent's needed value
│   │       Hold value: +bonus
│   │
│   └── Can opponent's discards already chain to their stock?
│       └── If yes: blocking is less valuable (they have the cards)
│
│   DISCARD FIT (how well C fits on available piles — see §4.7):
│   ├── C maintains descending order on a pile → low structural cost
│   ├── C creates a gap in a pile → moderate structural cost
│   ├── C breaks descending order (ascending placement) → high structural cost
│   └── This factors into the discard decision: cards that fit well cost less to discard
│
├── Compute: DISCARD COST = hold_value - discard_fit_quality
├── Discard the card with LOWEST hold_value (and best discard_fit as tiebreaker)
│
└── CURRENT AI COMPARISON:
    Current: always discards highest non-SKIP-BO card
    Optimal: discards the card whose removal from hand is least costly
    Example where current AI is wrong:
      Hand: [12, 4, 3], stockpile needs 5, piles need [3, 8, 11, 1]
      Current AI discards 12 (highest)
      Optimal discards 4 or 3: the 12 is about to be playable (pile at 11),
      while 3 and 4 are far from the stockpile path (need 5 next).
      Actually: 3 matches pile need [3]! Should have played it. But if we
      deliberately didn't play it (§4.2), then 4 is the best discard.
```

### 4.7 Discard Pile Selection: Where to Place

```
Place card C on which of 4 discard piles?
│
├── TIER 1: Contiguous descending (pile.top = C + 1)
│   ├── This creates a perfect chain: playing C later reveals C+1 → play C+1 → ...
│   ├── BEST possible placement
│   └── If multiple piles qualify, pick the one with the longer contiguous run
│
├── TIER 2: Same value (pile.top = C)
│   ├── Groups identical values together
│   ├── Benefits:
│   │   ├── Playing C reveals another C → can play on 2 different building piles
│   │   ├── Concentrates "denial" of value C (blocking)
│   │   └── Doesn't break any chain structure
│   └── Minor penalty: both copies become accessible sequentially, not simultaneously
│
├── TIER 3: Empty pile
│   ├── Clean start — preserves all existing pile structure
│   ├── Keeps C independently accessible without damaging other piles
│   ├── Consider: does C start a range that complements existing piles?
│   │   └── If piles cover [12-9], [8-6], [5-3], empty pile + C=2 → covers [2-1]
│   ├── Almost always better than creating a gap on an existing pile
│   └── Only downside: uses up an empty slot (only 4 piles total)
│
├── TIER 4: Adjacent gap descending (pile.top = C + 2)
│   ├── Small gap — close to chaining (only 1 intermediate card needed)
│   ├── Playing C reveals C+2, which is only 1 step past C+1 on building pile
│   ├── Acceptable when no empty piles remain
│   └── Prefer over larger gaps
│
├── TIER 5 (AVOID): Large gap descending — "bricking" (pile.top > C + 2)
│   ├── "Bricking" = placing a non-adjacent, non-same value card on a pile
│   ├── Destroys chain potential: play C → reveal mid-gap card → can't continue
│   ├── Locks two cards into a non-productive relationship
│   │   ├── The buried card (pile.top) becomes inaccessible until C is played
│   │   └── When C is played, revealed card won't chain (gap too large)
│   ├── Example: 4 on 7 → playing 4 reveals 7, but pile needs 5 not 7
│   ├── LAST RESORT ONLY — use empty pile or even ascending before this
│   └── If forced: prefer pile whose top card is LEAST useful (farthest from any need)
│
├── TIER 6 (AVOID): Ascending placement (pile.top < C)
│   ├── This BURIES the current top card under a higher card
│   ├── The buried card becomes inaccessible until building piles pass C
│   ├── Cost analysis:
│   │   ├── How useful is the buried card? (does it match any pile within 3?)
│   │   ├── How many turns until C would be played from this pile?
│   │   └── Is there truly no better option?
│   ├── If must do ascending: pick pile whose top is LEAST useful
│   │   └── Pile with top = 2, needs 3 on piles → burying 2 is very costly
│   │   └── Pile with top = 11, no pile near 11 → burying 11 is cheap for now
│   └── If ALL piles would bury useful cards → choose shortest pile (least deep burial)
│
│   NOTE on Tier 5 vs 6: In many cases ascending is actually BETTER than large-gap
│   bricking, because at least the newly placed card (C) is high and may be played
│   sooner, while bricking locks BOTH cards into a useless arrangement. Evaluate
│   case-by-case based on which cards are closer to being needed.
│
└── SPECIAL CONSIDERATIONS:
    ├── OPTION COVERAGE: The purpose of 4 discard piles is to maximize the
    │   statistical probability of future chains by providing diverse entry
    │   points across different value ranges.
    │   ├── Each discard pile top represents a value you can play when a
    │   │   building pile reaches it — more DISTINCT top values = more chances
    │   │   to play on any given turn
    │   ├── Duplicate tops (two piles both showing 8) provide redundancy but
    │   │   zero additional coverage — you can already play an 8 from one pile,
    │   │   having a second doesn't help unless two building piles need 8
    │   │   simultaneously
    │   ├── Prefer placements that create a new accessible value over ones that
    │   │   duplicate an existing top: 4 distinct tops > 3 distinct + 1 duplicate
    │   └── This principle should emerge naturally from chain evaluation: a
    │       placement that adds coverage scores higher because it creates new
    │       chain entry points that didn't exist before
    │
    ├── Blocking placement: if C = opponent_stock - 1, placing on discard
    │   "hides" it from building piles → opponent can't benefit from it
    │   (but you also can't play it without advancing toward opponent)
    │
    ├── Pile balance: avoid one pile becoming very deep (many buried cards)
    │   Deep piles have many inaccessible cards = wasted resources
    │
    ├── Anticipate future discards: if your hand also has C-1, plan to
    │   discard C-1 on the same pile NEXT turn (building the descending chain)
    │
    └── LAYERED PILE RECOGNITION:
        A pile like [7, 7, 6] looks "messy" to a naive evaluator but is actually
        a clean, intentional structure: a same-value layer (7, 7) on top of a
        contiguous descending pair (7→6).

        Playing from this pile chains perfectly:
          play 7 → reveals 7 → play 7 → reveals 6 → play 6 (if pile needs it)

        A pile's "chain quality" should be measured by its actual chain potential,
        not just adjacency of consecutive cards. Structures to recognize:
        ├── Same-value stacking: [V, V, V] → all playable when a pile needs V
        ├── Layered descending: [V, V, V-1] → play V, V, then V-1 chains
        ├── Multi-layer: [8, 7, 7, 6] → play 8, then 7, 7, then 6
        └── These are all HIGH quality piles despite appearing non-trivial

        This matters for discard SOURCE selection: never play from a layered pile
        when the same card is available from a messier pile (see §4.5)
```

---

## 5. Probability Reference Tables

### 5.1 Drawing a Specific Value (Hypergeometric)

P(at least 1 copy of value V in K draws from deck):

**Early game** (deck ≈ 92, unknown pool ≈ 155, 2-player):

| Copies remaining (r) | In 5 draws | In 10 draws | In 15 draws |
| -------------------- | ---------- | ----------- | ----------- |
| 12 (unseen)          | 32.4%      | 54.3%       | 69.0%       |
| 10                   | 28.0%      | 47.8%       | 62.0%       |
| 8                    | 23.0%      | 40.2%       | 53.6%       |
| 6                    | 17.7%      | 31.7%       | 43.3%       |
| 4                    | 12.0%      | 22.0%       | 31.0%       |
| 2                    | 6.1%       | 11.6%       | 16.7%       |
| 1                    | 3.1%       | 5.9%        | 8.6%        |

**Mid game** (deck ≈ 55, unknown pool ≈ 100):

| Copies remaining (r) | In 5 draws | In 10 draws | In 15 draws |
| -------------------- | ---------- | ----------- | ----------- |
| 12 (unseen)          | 47.3%      | 72.2%       | 85.4%       |
| 10                   | 41.1%      | 65.2%       | 79.7%       |
| 8                    | 34.0%      | 56.6%       | 72.0%       |
| 6                    | 26.1%      | 45.5%       | 60.2%       |
| 4                    | 17.7%      | 32.3%       | 44.7%       |
| 2                    | 9.1%       | 17.3%       | 24.7%       |

**Late game** (deck ≈ 30, unknown pool ≈ 60):

| Copies remaining (r) | In 5 draws | In 10 draws |
| -------------------- | ---------- | ----------- |
| 12 (unseen)          | 66.5%      | 88.8%       |
| 8                    | 51.5%      | 76.5%       |
| 4                    | 29.0%      | 49.5%       |
| 2                    | 15.3%      | 28.0%       |

### 5.2 SKIP-BO Draw Probability

SKIP-BO has 18 copies (vs 12 for numbered values).

| Copies remaining | Deck ≈ 92 | Deck ≈ 55 | Deck ≈ 30 |
| ---------------- | --------- | --------- | --------- |
| 18 (unseen)      | 44.8%     | 67.2%     | 85.5%     |
| 14               | 36.6%     | 57.8%     | 77.5%     |
| 10               | 27.3%     | 45.5%     | 65.0%     |
| 6                | 17.0%     | 29.7%     | 45.8%     |
| 3                | 8.8%      | 15.8%     | 25.6%     |

### 5.3 Cycling Expected Value

When you play all hand cards and draw 5 new ones, the expected number of
"useful" cards (matching any building pile need) depends on how many values
are currently needed and how plentiful those values are.

**4 building piles needing 4 distinct values, early game:**

| Values needed | Approx remaining per value | P(≥1 useful in 5) |
| ------------- | -------------------------- | ----------------- |
| 4 distinct    | 12 each → 48 total useful  | 81.5%             |
| 4 distinct    | 8 each → 32 total useful   | 64.8%             |
| 4 distinct    | 4 each → 16 total useful   | 40.5%             |
| 2 distinct    | 12 each → 24 total useful  | 57.3%             |
| 2 distinct    | 8 each → 16 total useful   | 40.5%             |

**Including SKIP-BO as "useful" (wild — always matches):**
Add the remaining SKIP-BO count to "total useful" before computing.
With 14 SKIP-BOs remaining, 4 distinct values at 8 each:
Total useful ≈ 32 + 14×92/155 ≈ 32 + 8.3 = 40.3 → P(≥1) ≈ 73.0%

**Takeaway**: cycling has a ~65-80% chance of finding at least one playable card
in the early-mid game when building piles need common values. It drops to ~40%
when needed values are scarce.

---

## 6. Game Phase Strategy

### 6.1 Early Game (Stockpile: 30→20)

**State**: Building piles are empty or very low. Need 1s to start. Little information.

```
Priority list:
1. Play 1s from any source → start building piles
2. Play low cards (2-4) to advance started piles
3. Cycle aggressively: play whatever matches to draw fresh cards
   └── Cycling is highest value here because:
       ├── Most cards are unseen → high draw diversity
       ├── Building piles are safe to advance (far from anyone's stock value)
       └── Need to find 1s (most important early card)
4. Build discard structure: start placing high cards (10-12) on discard piles
   └── These won't be needed for many turns
   └── Get them out of hand to make room for low cards
5. SKIP-BO: valuable to start piles (as 1) or bridge early gaps
   └── Don't waste on piles above 4 unless it enables a chain
```

**Discard strategy early game:**

- Discard high cards first (12, 11, 10) → won't be needed for many turns
- Start building descending discard piles: first discard 12, then 11 on same pile, etc.
- Keep low cards in hand (more immediately useful)

**Opponent awareness early game:**

- Minimal: opponent's stockpile is probably a random value, piles are far from it
- Focus on your own progress rather than blocking

### 6.2 Mid Game (Stockpile: 20→10)

**State**: Building piles at various heights. Significant card information accumulated.

```
Priority list:
1. Play stockpile whenever possible (still highest priority)
2. Build chains toward stockpile value:
   └── If stock = 8, and pile needs 5, look for 5-6-7 to bridge
3. Card counting becomes critical:
   ├── Track how many of each value remain
   ├── Identify scarce values → hold them or plan around them
   └── Estimate opponent's hand composition from their plays/discards
4. Opponent blocking:
   ├── Be aware of piles approaching opponent's stock value
   ├── Stop advancing piles within 2 of opponent's stock value
   └── Hold copies of opponent's stock value or stock-1
5. Selective cycling: only cycle when hand is genuinely poor
   └── Riskier now because pile advancement might help opponent
6. Discard optimization: piles should be well-structured
   └── Descending chains enable future plays when piles catch up
```

**Discard strategy mid game:**

- More nuanced: consider what values building piles will need in 3-5 turns
- Maintain descending order strictly
- Group blocking values (near opponent's stock) in discards to deny them

**Opponent awareness mid game:**

- Track their discard pile structure (what chains are they building?)
- Note their stockpile count (who's ahead?)
- If opponent is cycling aggressively, they're probably stuck (missing key values)
- If opponent is discarding low values, they likely have plays (keeping high cards for chains)

### 6.3 Late Game (Stockpile: 10→1)

**State**: Most cards have been seen. Building piles may be high or recently reset.

```
Priority list:
1. Every stockpile play is critical — closer to winning
2. Plan multi-turn chains:
   ├── "If I play X now, next turn pile needs Y, I have Y in discard"
   └── "If I hold this SKIP-BO, next turn I can bridge Z to stockpile"
3. SKIP-BO preservation: save for exact moment it enables stockpile play
   └── With fewer cards in deck, SKIP-BO draws are less likely
4. Active blocking if opponent is close:
   ├── If opponent has 3 cards left in stock → maximize disruption
   ├── Advance piles AWAY from opponent's stock value
   └── Hold critical blocking values even at cost to own progress
5. Race conditions: if both players are close, speed > caution
   └── Accept some risk of helping opponent if it progresses you faster
```

**Discard strategy late game:**

- Surgical: every discard matters
- Don't discard any value you might need in the next 3 turns
- Card counting: if only 1 copy of a needed value remains, NEVER discard it
- Sometimes worth discarding on an "ascending" pile if the card is truly useless

---

## 7. Opponent Modeling & Interaction

### 7.1 Reading Opponent's Hand

From opponent's actions, infer what they hold:

```
OPPONENT PLAYS:
├── They play card V on pile P → they had V (now gone from hand)
├── They DON'T play on pile P that needs V → they likely don't have V
│   └── Exception: they might be holding V for strategic reasons (blocking you!)
├── They cycle (play many hand cards quickly) → their hand was poor, drawing for answers
└── They play SKIP-BO on a specific pile → that pile is strategically important to them

OPPONENT DISCARDS:
├── They discard high card → hand probably has lower, more useful cards
├── They discard low card → unusual, might have all high cards or a specific plan
├── They discard same value as pile needs → they chose not to play it (blocking? saving?)
└── Discard pile structure reveals their strategy:
    ├── Well-ordered descending piles → playing for long-term
    ├── Chaotic piles → short-term focus or struggling
    └── Same-value grouping → possibly blocking specific values
```

### 7.2 Blocking Decision Tree

````
Should I block opponent?
│
├── How close is opponent to winning?
│   ├── Stock ≤ 5 → HIGH PRIORITY blocking
│   ├── Stock 6-15 → MODERATE blocking (don't sacrifice own progress much)
│   └── Stock > 15 → LOW priority (focus on own game)
│
├── Can I block effectively?
│   ├── Do I hold copies of their stock value or stock-1? → yes, effective
│   ├── Can I avoid advancing piles toward their stock? → yes, moderate
│   └── Can I advance piles PAST their stock value? → yes, they can't use it then
│       └── Caveat: advancing past means using V, V+1, V+2... → do I have those cards?
│
├── What does blocking cost me?
│   ├── If I hold blocking cards, they take hand space → fewer useful cards for me
│   ├── If I stop advancing piles, my own progress slows
│   └── If I advance piles past opponent's value, I help them indirectly (pile gets higher)
│
├── DECISION:
│   ├── Opponent stock ≤ 3 AND I can block cheaply → BLOCK
│   ├── Opponent stock ≤ 5 AND blocking costs < 1 turn of progress → BLOCK
│   ├── Opponent close but blocking very expensive → RACE (play for speed)
│   └── Opponent far from winning → IGNORE blocking, focus on own play
│
├── THE "DANGER ZONE" PRINCIPLE:
│   The danger zone is NOT simply "pile needs opponent_stockpile_value." It must
│   account for ALL of the opponent's VISIBLE cards that can bridge the gap.
│
│   EFFECTIVE DANGER DISTANCE:
│   The opponent's discard piles are fully visible (all cards, not just tops).
│   Combined with their stockpile top, these form a set of known cards the
│   opponent can potentially play. To compute the danger zone, count how many
│   UNKNOWN cards the opponent would need to chain from the pile's current
│   need to their stockpile value.
│
│   ```
│   For a pile needing value N, with opponent stockpile S:
│   chain_values_needed = [N, N+1, N+2, ..., S-1]  (cards needed to reach S)
│   opponent_visible = all cards in opponent discard piles
│                    + opponent stockpile top
│                    + SKIP-BO cards (wild, count as any value)
│   gaps = count(values in chain_values_needed NOT covered by opponent_visible)
│
│   gaps ≤ 2 → DANGER ZONE (opponent needs one or two lucky draws)
│   gaps = 0 → CRITICAL (opponent has everything visible to reach stockpile)
│   ```
│
│   IMPORTANT: Scan ALL cards in opponent's discard piles, not just tops.
│   Discard piles are LIFO — the opponent plays the top card, revealing the
│   next one. A pile like [11, 10, 9, 8, 7] is a complete chain from 7→11
│   that fires sequentially once a building pile reaches 7.
│
│   Example: piles all at 4 (need 5), opponent stockpile = 12, opponent has
│   a discard pile [11, 10, 9, 8, 7].
│   - Chain needed: [5, 6, 7, 8, 9, 10, 11] — 7 values
│   - Opponent visible: {7, 8, 9, 10, 11} — covers 5 of 7
│   - Gaps = 2 (missing 5 and 6) → not yet in danger zone
│   - You play a 5: pile needs 6. Chain needed: [6, 7, 8, 9, 10, 11]
│   - Opponent covers {7, 8, 9, 10, 11} — gaps = 1 (just the 6)
│   - DANGER ZONE: opponent needs ONE card (6) to chain all the way to
│     stockpile 12 via their discard pile.
│   - Playing the 5 is what enters the danger zone — even though the pile
│     is 7 steps from opponent's stockpile in raw distance.
│
│   BLOCKING IS ONLY RELEVANT AT TURN END:
│   Turns are strictly alternating — the opponent CANNOT play during your turn.
│   Mid-turn plays are free: advancing a pile into the danger zone is fine as
│   long as you bridge past it before discarding. Only the FINAL board state
│   (after your discard) matters for blocking evaluation.
│
│   ├── If you CAN bridge past the danger zone this turn → advance freely
│   │   The pile is only at the dangerous value during YOUR turn — opponent
│   │   never gets a chance to exploit it.
│   │
│   ├── If you CAN'T bridge past → DON'T advance into the zone
│   │   Hold the cards, wait until you collect the full bridge sequence
│   │   (e.g., hold 3,4 and wait for 5,6,7 to play 3→4→5→6→7→8(stock)
│   │   in one turn)
│   │
│   └── "Safe" plays that don't enter the zone are always acceptable
│       Completing piles (12→reset to 1) and restarting low is safe
│       Advancing piles that are far from opponent's stock is safe
│
└── PLAYER COUNT SCALING:
    Blocking weight should scale inversely with player count.

    1v1 (2 players):
    ├── Blocking is CRITICAL — only one opponent to track
    ├── Every card you play toward their stock is a direct gift
    ├── Holding bridge cards is high value (only 2 people drawing)
    └── Opponent proximity penalties should be HIGH

    3-4 players:
    ├── Blocking is MODERATE — more opponents, harder to track all
    ├── Other players advance piles unpredictably, reducing your control
    ├── Multiple stockpile values to worry about simultaneously
    └── Opponent proximity penalties should be MEDIUM

    5-6 players:
    ├── Blocking is LOW — chaos dominates strategy
    ├── Piles advance rapidly from multiple players cycling
    ├── Individual blocking has minimal impact (5 others are playing)
    └── Focus on own progress, opponent proximity penalties LOW

    Implementation: multiply all opponent_proximity penalties by a
    player_count_factor:
      2 players: factor = 1.0 (full weight)
      3 players: factor = 0.6
      4 players: factor = 0.4
      5+ players: factor = 0.2
````

### 7.3 Advancement Race Analysis

When both players are close to winning:

```
My stock: S_me,  Opponent stock: S_opp

If S_me < S_opp → I'm ahead → play cautiously, don't give free advancement
If S_me > S_opp → I'm behind → play aggressively, accept risks
If S_me ≈ S_opp → race → every turn counts

TEMPO CONCEPT:
├── A "tempo" is roughly the expected number of turns to play 1 stockpile card
├── Average tempo depends on: stockpile value, building pile positions, hand quality
├── If I can play stockpile this turn → tempo advantage
├── If opponent can likely play stockpile next turn → tempo disadvantage
└── Gaining tempo: play stockpile + set up next stockpile play in same turn
```

---

## 8. Critical Edge Cases

### 8.1 The "Trap" Discard

Discarding a card that will NEVER be accessible because it's buried under a growing pile.
Example: Discard pile [8, 7, 6]. Building pile needs 6. You play 6 → reveals 7 → play 7
→ reveals 8 → play 8. Pile now needs 9. Discard pile is empty.

But if you discard a 3 on this pile: [8, 7, 6, 3]. Now you play 3 (if pile needs 3)
→ reveals 6 → but pile now needs 4, not 6. The 6 is TRAPPED until a pile needs 6 again.

**Rule: never bury a lower card under higher cards unless you're sure the lower card
won't be needed before the higher ones.**

### 8.2 The "Double Discard" Opportunity

When two discard piles show the same value, and a building pile needs that value:

- Play from pile A → reveals card underneath → might chain
- Pile B still has the same value accessible as backup
- This gives you TWO attempts to build a chain from that value

**This should factor into SKIP-BO placement: prefer creating pile needs that
match duplicate discard values.**

### 8.3 The "Pile Completion Reset"

When a building pile reaches 12, it resets to needing 1. This changes everything:

- Cards near 12 that were "almost useful" become irrelevant
- 1s become critical again (to restart the pile)
- The completed pile's cards return to the deck (shuffled) → changes probabilities

Anticipating pile completions is important:

- If a pile is at 10, it will likely complete soon
- Don't build chains that depend on this pile being at 11+ — it might reset
- Start preparing 1s and low cards for the reset

### 8.4 The "Sacrifice Pile" Strategy

When the game stalls (extended back-and-forth, neither player can play their stockpile),
forced bad discards accumulate. Rather than spreading damage across all 4 discard piles,
deliberately concentrate non-adjacent/messy discards onto ONE pile.

**The lifecycle:**

```
1. TRIAGE: Designate one pile as the sacrifice target when forced into bad discards
   ├── Pick the pile with worst existing structure (already bricked, or least useful top)
   ├── All non-adjacent, non-same-value discards go here
   └── Preserve the other 3 piles' chain potential

2. OPPORTUNISTIC CLEANUP: As building piles advance, play cards off the messy pile
   ├── Even if it's not the highest-value play, restoring pile health has future value
   ├── Treat messy pile tops as "bonus plays" — play them whenever they match
   └── Gradually drain the pile as building piles catch up to its buried values

3. RESTORED: Eventually the pile is clean or empty, chain potential returns
```

**Why this works:**

- Three clean piles with intact chains > four mediocre piles with broken chains
- Concentrates damage: one pile temporarily loses chain potential instead of all four
- Reduces future discard decision complexity (messy pile is the default dump)

**Implementation insight:**
This behavior should emerge naturally from proper discard scoring rather than an
explicit rule. If the penalty for bricking scales with a pile's current "chain quality":

- Bricking an already-bricked pile costs almost nothing
- Bricking a pile with a perfect descending chain costs a lot
- The AI will naturally converge on reusing the worst pile as the sacrifice target

**Cleanup valuation:**
The current evaluation framework doesn't capture "structural repair" value. Playing a
card off a messy discard pile has hidden value beyond the immediate chain: it restores
that pile's future flexibility. This should be scored as a bonus when evaluating plays
from discard sources — especially when the pile underneath is also messy and continued
plays can clean multiple cards.

### 8.5 The "SKIP-BO Flood"

When you have 2-3 SKIP-BOs in hand:

- Enormous flexibility — can bridge almost any gap
- But using all of them aggressively depletes a scarce resource
- **If 2 SKIP-BOs**: use 1 to bridge, save 1 for stockpile emergency
- **If 3 SKIP-BOs**: use 1-2, keep at least 1 in reserve
- **Exception**: if using all of them empties stockpile → use them all (you win!)

### 8.6 The "Dead Hand"

When your hand has no playable cards and all discards are blocked:

- Must discard and end turn
- Goal: minimize damage from forced discard
- Choose the card that:
  - Fits best on a discard pile (maintains structure)
  - Has lowest future value
  - Blocks opponent if possible (place near opponent's needed value in discards)
- This situation is where good discard management pays off:
  well-structured discard piles = more accessible cards = fewer dead hands

---

## 9. Complete Decision Evaluation Formula

For each candidate action A in a game state S:

```
VALUE(A, S) =
    // Direct stockpile progress
    + 100 × stockpile_plays_in_chain(A)

    // Chain quality
    + 5 × plays_before_and_including_stockpile(A)
    + 2..5 × plays_after_stockpile(A)  // +5 if hand empties, +2 otherwise
    + 3 × discard_cards_revealed(A)    // or quality-aware bonus when enabled
    + 2 × piles_completed(A)

    // Cycling bonus (if action empties hand)
    + hand_empties(A) × cycling_EV(S)

    // Pile advancement toward own stockpile
    + 3 × steps_toward_own_stock(A)
    + 10 × one_step_from_own_stock(A)  // next play could be stockpile

    // Opponent danger zone (NEGATIVE) — uses effective distance (§7.2)
    // Accounts for ALL visible opponent cards (full discard piles + stock top)
    - 30 × enters_danger_zone(A)       // effective_distance ≤ 2 after this play
    - 50 × enables_opponent_stock(A)   // effective_distance = 0 after this play

    // Stockpile ordering (§4.3 stockpile-first principle)
    // Penalize plays before the stockpile that don't enable it
    - 7 × unrelated_plays_before_stockpile(A)

    // Card cost
    - 15 × skipbo_cards_used_with_stockpile(A)   // SKIP-BO that enables stockpile play
    - 30 × skipbo_cards_used_without_stockpile(A) // SKIP-BO with no stockpile payoff
    - 3..5 × scarce_cards_used(A)  // -5 for ≤2 remaining, -3 for ≤4 remaining

    // Blocking value
    + 8 × opponent_values_denied(A)

    // Source selection bonus (for play actions from discard piles)
    + 15 × reveals_chain_card(A)       // card underneath extends current chain
    + 5 × reveals_useful_card(A)       // card underneath is playable elsewhere

    // Discard quality impact (for discard actions)
    + 5 × maintains_descending_order(A)
    + 3 × contiguous_placement(A)
    + 3 × increases_option_coverage(A) // new distinct top value vs duplicate
    - 10 × breaks_descending_order(A)
    - 5 × buries_needed_card(A)
```

The "stop playing" action has VALUE = 0 (keep current state).
The "hold instead of play" action has VALUE = hold_value of the card.

**Choose the action with highest VALUE(A, S).**

In practice, these weights should be discovered by self-play tuning, not fixed.
The formula above is a starting framework showing WHAT factors matter, not the
exact weights. The current implementation's weights were tuned through
play-testing and intentionally diverge from earlier theoretical values.

---

## 10. Summary: Principles of Optimal Play

1. **Always play stockpile** — the only winning move
2. **Chain-maximize SKIP-BO placement** — simulate the full chain, not just next card
3. **Sometimes don't play** — if every play helps opponent more than you
4. **Play order matters** — enumerate orderings to find best sequence
5. **Cycle when hand is poor and piles are safe** — but quantify "poor" and "safe"
6. **Descending discard piles** — turns LIFO stacks into FIFO chains
7. **Contiguous sequences** — gaps break chains and waste buried cards
8. **Card count everything** — base decisions on probabilities, not hunches
9. **Block when cheap, race when expensive** — blocking costs progress
10. **Discard the least valuable card** — not always the highest number
11. **Duplicate discards = double opportunity** — factor into SKIP-BO placement
12. **Anticipate pile resets** — don't plan around piles that are about to complete
13. **SKIP-BO is precious** — save it unless chain value clearly justifies the cost
14. **Read opponent discards** — their choices reveal their hand and strategy
15. **Discard decisions serve multi-turn sequences** — plan across all 4 discard piles, not one at a time
16. **Prefer playing from hand over discard** — hand cards consumed = closer to cycling.
    Exception: when a discard pile has a chain-enabling card underneath, prefer discard
    (chain extension outweighs cycling benefit)

---

## 11. Cross-Pile Sequence Planning

### The Key Insight

The current framework (§4.6, §4.7) evaluates discard decisions as isolated choices:
"Which card has lowest hold value?" and "Which pile gives best tier placement?"

**Experienced players don't think this way.** They plan multi-turn sequences that span
ALL discard piles, hand cards, and building pile advancement simultaneously. The discard
decision is a move in service of that sequence, not an independent optimization.

### How It Works

Before discarding, map out the full sequence of plays you expect to make over the
next 1-2 turns across all your discard piles and hand:

```
1. Identify your "runway" — the longest ascending sequence you can assemble
   from cards across your hand + discard pile tops
   Example: discards have 6(pile1), 8(pile3), 9+10(pile4), hand has 7,8,9
   Runway: 6→7→8→9→10 spanning 3 sources

2. For each card in hand, ask: "where does this card slot into the runway
   if I discard it vs if I keep it?"
   - Card in hand plays from hand → consumes hand card → closer to cycling
   - Card on discard pile plays from discard → preserves hand → slower cycling

3. Choose the discard that PRESERVES the runway while maximizing hand card
   consumption during the sequence
```

### Worked Example (from actual gameplay)

**State:**

- Building pile 2 needs 6
- Hand: [7, 8, 9], Stockpile: 5 (needs pile to reach 5 first)
- Discard pile 1: [7, 7, 6] (top=6), Pile 3: [5, 8] (top=8), Pile 4: [12, 10, 10, 9] (top=9)

**Sequence identified:** 6→7→8→9→10 (leads to continued building pile advancement)

**Option A: Discard 7→pile 3 (on the 8)**
Next turn sequence: 6(pile1)→7(pile3)→8(pile3)→9(pile4)→10(pile4)
Hand cards consumed: 0 from this sequence (9 held as bridge to unlock pile 4)
All plays come from discard piles.

**Option B: Discard 8→pile 4 (on the 9)**
Next turn sequence: 6(pile1)→7(hand)→8(pile4)→9(pile4)→10(pile4)
Hand cards consumed: 1 (the 7 plays from hand)
One more hand card used = one step closer to cycling.

**Chosen: Option B** — both preserve the full runway, but B plays one more hand card,
bringing the player closer to an empty hand and fresh draw.

### Decision Weights Revealed

From this analysis, the implicit weight ordering for discard decisions:

```
1. SEQUENCE PRESERVATION (dominant)
   Does this discard break or preserve my cross-pile runway?
   Any option that breaks the sequence is immediately rejected,
   regardless of how good the tier placement looks in isolation.

2. HAND CARD CONSUMPTION (tiebreaker between sequence-preserving options)
   Which option lets me play MORE cards from hand during the sequence?
   Playing from hand > playing from discard because:
   ├── Each hand card played = one step closer to cycling (draw 5)
   ├── Discard pile cards are "stored" — they'll wait, hand cards won't
   └── Cycling brings fresh cards = new opportunities

3. NATURAL PLAYABILITY (hold value)
   Cards closer to current building pile needs have higher hold value —
   not because of raw distance, but because they're more likely to be
   played naturally without being stuck in hand across multiple turns.
   ├── 7 > 8 > 9 when piles are at 3-4 range (7 is closest to playable)
   └── This isn't about "how many steps away" in isolation, but about
       the likelihood the card will flow naturally into a building pile

4. TIER PLACEMENT (subordinate to all above)
   Standard tier logic (§4.7) only matters AFTER the above factors are equal.
   A tier-2 placement that preserves the sequence beats a tier-1 placement
   that breaks it.
```

### Implication for AI Design

The current AI evaluates discards as: `score(card, pile) = hold_value + placement_tier`

It should instead:

1. Enumerate the cross-pile runway (longest ascending sequence across all sources)
2. For each (card, pile) discard option, simulate whether the runway is preserved
3. Among sequence-preserving options, prefer the one maximizing hand card consumption
4. Only use tier-based scoring as the final tiebreaker

This is fundamentally a **multi-turn lookahead on discard structure**, not a single-turn
scoring function. It requires the AI to "see" its discard piles as one interconnected
resource, not four independent stacks.

**Implementation note:** The current AI uses combined `(card, pile)` formula scoring
rather than the hierarchical sequential approach above. This is intentional — the
combined approach handles tradeoffs between card selection and pile placement more
flexibly, with runway detection as a weighted bonus (±3/±8) rather than a hard
constraint. The flat formula can approximate the hierarchy when weights are tuned
correctly, while avoiding edge cases where rigid sequencing misses non-obvious
optimal placements.
