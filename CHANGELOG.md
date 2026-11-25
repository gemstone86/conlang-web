# Changes

## v1.94.1 (combined app)

- Dawn: minor wonders no longer cost production upkeep; only great wonders of earlier eras do.

## v1.94.0 (combined app)

- Dawn: the "End of an Era" cards are gone. One era-end event (chosen at random from the era's list) now lies at the very bottom of each era deck, and the era ends when it is turned up; its effects still last through the next era. The last era has a single end card at the bottom that wins the game. Eras now last until the deck is nearly used up, so required cards (Agriculture, Metalworking, Markets) always come up.

## v1.93.11 (combined app)

- Dawn: the face-down card you get with an event is always shown (it used to be skipped when it was a city state or great wonder, which never reach the hand); the turn-start draw pop-up also says what a city state does.

## v1.93.10 (combined app)

- Dawn: New Trading Route is now a standing route: every round you pay 1 of one resource and your ally gets 2 of the other (shown in both players' per-round income).

## v1.93.9 (combined app)

- Dawn: cards with art now show the picture as a banner on top and the text on a solid dark panel below, so it is readable everywhere (hand, queue, event popup, catalogue).

## v1.93.8 (combined app)

- Dawn: card art for the 22 Classical cards: Iron Working, Philosophy, Mathematics, Engineering, Roman Concrete, Pericles, Hannibal, Cleopatra, Cyrus, Augustus, Legion Tactics, Aqueducts, The Forum, Pax Romana, Gallic Warband, The Goths Invade, Hannibal at the Gates, End of an Era (Classical), The Parthenon, The Colosseum, The Pantheon and The Great Wall.

## v1.93.7 (combined app)

- Dawn: card art for 21 more cards: Lithic Art, Legendary Predator, Climate Crisis, Cult of the Ancestors, End of an Era (Prehistoric), Metalworking, Markets, Bronze Age Collapse, The Iron Age Dawns, Age of Philosophers, Hatshepsut, Sargon, King Minos, Imhotep, Irrigation Canals, Sailing, The Pharaoh's Curse, Volcano of Thera, the Palace of Knossos, the Ziggurat of Ur and the Temple of Karnak.

## v1.93.6 (combined app)

- Dawn: the era banner shows the era-end event that closed the previous era as a card (Dawn of Agriculture, Climate Crisis...). When the whole game ends there is no new era and so no card.

## v1.93.5 (combined app)

- Dawn: hover over "Hand N" in The tribe to see that player's cards (the server now sends every player's hand to the team).

## v1.93.4 (combined app)

- Dawn: fixed a required card (Markets, Stone Tools, Agriculture, Metalworking) turning up twice in an era deck: it is put in once, and the random fill no longer draws another copy.

## v1.93.3 (combined app)

- Dawn: before a bot sends resources, troops or settlers to a land found by an event, it checks that the players can pay all of it together. If they can't (the land would be lost anyway), it sends nothing.

## v1.93.2 (combined app)

- Dawn: a big banner opens each era: "Prehistory / The prehistoric era begins…", then "The ancient era begins…" and so on, with the era-end effects carried over listed under it. Click to close, or it fades after a few seconds.

## v1.93.1 (combined app)

- Dawn: lands found by an event, crises and lasting events are laid out in a grid instead of one long column, and the Done / Look at the board buttons of the event pop-up stay in view at the bottom, so you no longer have to zoom out.

## v1.93.0 (combined app, branch new-era)

- Dawn: the Ancient and Classical eras filled out. Ancient: wonders Palace of Knossos, Ziggurat of Ur and Temple of Karnak; great people Hatshepsut, Sargon of Akkad, King Minos and Imhotep; techs Irrigation Canals and Sailing; events Pharaoh's Curse and Volcano of Thera. Classical: wonders The Pantheon and The Great Wall; great people Cleopatra, Cyrus the Great and Augustus; techs Roman Concrete and Legion Tactics (a Warriors slot card); minor wonders Aqueducts and The Forum; the crisis Hannibal at the Gates (a strength-5 card added to the enemy deck each round, then a raid and an invasion) and the boon Pax Romana.

## v1.92.0 (combined app)

- Dawn: a Classical era (iron age, classical Greece, Rome) now follows the Ancient era, and ending it wins the game. The Ancient era is now the early civilisations (bronze age, Egypt, Mesopotamia) and ends with one of three era-end events: Bronze Age Collapse, The Iron Age Dawns or Age of Philosophers. The Greek and Roman cards moved to the Classical era: The Great Library, Great Lighthouse, Colossus, Roman Roads, Tomyris, Alexander, Julius Caesar, Archimedes, Code of Laws. New in Classical: wonders The Parthenon and The Colosseum, great people Pericles and Hannibal, techs Iron Working, Philosophy, Mathematics and Engineering, and the raid and invasion Gallic Warband and The Goths Invade. Hostility is split between the eras (Ancient 2s and 3s, Classical 3s and 5s).

## v1.91.0 (combined app)

- Dawn: under Buildings there is now a Population section with the idle population and the warriors, each with bonus slots like a building. The population starts with no bonus slot, the warriors with one. Spearmen is now a bonus-slot card for the warriors: slot it to get its stronger troops (and the dearer training and upkeep), take it out (1 action) when the economy needs relief. Troop strength bonuses from slotted cards are per player.

## v1.90.0 (combined app)

- Dawn: admins get a "Cheat mode" button in the top bar (nobody else sees it, and the server refuses the message from anyone else). While it is on, your resources and actions are topped up after every move, so every card, building and payment is free with unlimited actions. It is logged in the game log.

## v1.89.4 (combined app)

- Dawn: techs and minor wonders whose bonus needs an upgrade slot carry a "Bonus slot" tag (on the card, the small card and in the queue and hand).

## v1.89.3 (combined app)

- Dawn: minor wonders are shown as small cards like technologies (hover for the full card, drag into an upgrade slot, Remove button under your own). A building type that has been retired (Gatherers after Agriculture, Hunters after Metalworking) disappears from your list once nobody works in it and no card sits in it.

## v1.89.2 (combined app)

- Dawn: the Expand button now sits to the right of the building name. The queue loses 2 cards per round with 1-2 players and 1 card with 3 or more (it was the other way round).

## v1.89.1 (combined app)

- Dawn: the All cards list words the card counts as copies in the card list (all cards that exist), not cards in the current game.

## v1.89.0 (combined app)

- Dawn: upgrade slots are now small cards: an empty slot is an empty box, and a researched tech (shown as a small card in the Technologies list, hover for the full card) is dragged into it, or clicked and then the slot. New Prehistoric tech Lithic Art: slotted into Hunters it gives +1 culture per hunter, a choice against Stone Tools (production). Cards you pick fly from the queue to your hand, a tech flies into its slot, and the card you draw at the start of your turn flies out of the era deck. Prehistoric great wonders are cheaper (production 10/9/10/8/5 became 6/6/6/5/3) because hunters make less production than mines did. The All cards list shows how many copies of each card are in the game.

## v1.88.0 (combined app)

- Dawn: upgrade slots. Each building has upgrade slots (gatherers 1, hunters 1, farms 2, mines 2, temples, markets and villages 1) that never grow when the building is expanded. A tech or minor wonder that adds income or per-worker output now only works once you put it into a free slot of one of your buildings; its other effects (hand size, actions, health...) still work at once, and it counts for points either way. Every player can slot every researched tech, so players can end up with different bonuses. Slotting is free (pick the card in the building's slot menu); taking a card out costs 1 action. New actions slot and unslot; bots slot what they can.

## v1.87.0 (combined app)

- Dawn (branch hunter-gatherer): the Prehistoric era has no farms or mines. You start with Gatherers (2 food per worker) and Hunters (1 food and 1 production per worker); they use the same land slots farms and mines will. Agriculture (always in the Prehistoric deck) unlocks the Farm, stops more Gatherers from being built and makes growing cost 3 less; Metalworking (always in the Ancient deck) unlocks the Mine and stops more Hunters. Existing ones stay. Growing now costs 6 food (+1 per 2 people beyond the first). Stone Tools now makes hunters +1 production. New effect retireBuilding.

## v1.86.0 (combined app)

- Dawn: an era deck pile sits at the right end of the card queue (with the number of cards left). Cards drawn from it fly out of the pile into the queue, and the cards you draw each round fly into your hand. Nothing animates on the first load, and not when the browser asks for reduced motion.

## v1.85.3 (combined app)

- Dawn: new Prehistoric raid event, Legendary Predator: strength players + 2 (fixed, no enemy cards), each point short costs 2 food.

## v1.85.2 (combined app)

- Dawn: twice as many hostility cards in each era deck: 2 per player (was 1). The cards keep their values (+1, +2, +3, +5); there are more copies of each to make up the numbers.

## v1.85.1 (combined app)

- Dawn: a great person costs 4 per era (4 in the Prehistoric era, 8 in the Ancient era), not a flat 4. Stone Tools is now a required card: it is in every game. The great person rules text was updated too.

## v1.85.0 (combined app)

- Dawn: a finished great wonder now stands as a miniature card on the territory it was built on (hover it for the full card), and leaves the great wonders panel.

## v1.84.1 (combined app)

- Dawn: when a raid or invasion strikes, the popup shows the enemy cards that were drawn (and the fixed part), with your troops on the left and your allies' troops on the right.

## v1.84.0 (combined app)

- Dawn: enemy deck. Raids and invasions now draw cards from an enemy deck (it starts with six strength-1 and four strength-2 cards), add up their strength and shuffle them back. Massing enemies are a count: when an invasion comes, that many cards are drawn and added to players × territories. Raids draw Era number + a number written on the card (Wolf Pack +0, Rival Tribe +1, Barbarian Raid +2, Chariot Raiders +3); the Sea Peoples' raid draws 4 per era. The Sea Peoples crisis adds a strength-4 card to the deck every round it is active. The deck is shown in the status bar.

## v1.83.1 (combined app)

- Dawn: the End of an Era cards are shuffled through the whole era deck, not just the bottom part. The era-end event "Meteor Impact" is now called "Climate Crisis" (the Meteor Impact crisis card is unchanged).

## v1.83.0 (combined app)

- Dawn: new way for eras to end. Each era has three "End of an Era" cards in the bottom of its deck. They are turned up onto the queue, can't be taken, and drift left like other cards. When the third is turned up, a special era-end event strikes (one of three per era) and the next era's cards are drawn from then on. The event's bonuses and penalties last through the whole next era. Prehistoric: Dawn of Agriculture (+1 farm slot, invasions +2), Meteor Impact (+1 farm slot, colonies cost +1 settler), Cult of the Ancestors (+1 culture per turn, hand size -1). In the last era the third end card wins the game at the end of the round. Replaces the old single era-trigger event (Rise of Empires is gone).

## v1.82.1 (combined app)

- Dawn: a "Start" link back to the start page, and a "Log in" link on the Dawn start page for visitors who are not logged in (the start page sends them back to Dawn afterwards).

## v1.82.0 (combined app)

- Dawn: finished (or abandoned) games now save their game log on the server. Admins get an "All game logs" button that downloads every saved log, plus games still running, as one zip; the saved ones are deleted after the download. Logs live in `dawn.log-dir` (default `./data/dawn-logs`).

## v1.81.0 (combined app)

- Dawn: great persons are no longer played when drawn. They go to your hand and are played for 1 action and 4 resources of any kind, replacing your current great person. Unplayed ones leave with the era.

## v1.80.1 (combined app)

- Dawn: your resources (and net per round) now sit on a second line in the top bar.

## v1.80.0 (combined app)

- Dawn: hover your actions to see where they come from; hover per-round resources to see their sources; hover techs, bonuses, wonders, minor wonders and great people to see the card.


Newest first. Versions from 1.x on are the combined app (Root and Rune + Weather generator).

## v1.79.3 (combined app)

- Test only: two players paying for a city state together (no change in behaviour).

## v1.79.2 (combined app)

- Fix: v1.79.1 did not compile (a variable name clash in the net income line); this version does.

## v1.79.1 (combined app)

- Dawn: the Market has an upkeep of 1 food and 1 production every round (buildings can now have an `upkeep:` in `content.yaml`). It is part of production, shows in the net income line and is logged.

## v1.79.0 (combined app)

- Dawn: new Ancient tech Markets, which unlocks a new building for everyone: the Market (4 production and 2 culture; each worker produces 1 influence and 1 culture). Markets is a "required" card: it is always in the Ancient era deck (cards can now be marked `required: true` in `content.yaml`).

## v1.78.0 (combined app)

- Dawn: "Your people" shows the net income per round, after upkeep (for example the production lost to wonders of earlier eras), under the gross figures.
- Dawn: the great person line is gone from "Your people" (it has its own panel).

## v1.77.0 (combined app)

- Dawn: a Settle card in your hand can now be played from the hand: pick the land from the list and press "Play: make it a colony" (1 action). The old button on the land card still works.

## v1.76.1 (combined app)

- Dawn: colonization value is back to lowering a land's resource cost (production first, then food, 1 per player per point); the settler change of v1.76.0 is undone.

## v1.75.2 (combined app)

- Dawn: the last pictures (batch H: Rise of Empires, the crises and the four hostility cards). The four "land found" events use the pictures of their lands. Every card now has art.

## v1.75.1 (combined app)

- Dawn: ten more event pictures (batch G).

## v1.75.0 (combined app)

- Dawn: keywords. Rules words in card texts and panels (Stability, Health, Population, Raid, Invasion, Defense, Military strength, Troops, Settle, Colony, Territory, Great wonder, Minor wonder, Great person, Upkeep, Crisis, Response and more) are underlined with dots; hover (or tap) one to see a rules box. The first appearance in each card or panel is marked. The list lives in `content.yaml` under `keywords:`.

## v1.74.1 (combined app)

- Dawn: more event and crisis pictures (batch F, partial).

## v1.74.0 (combined app)

- Dawn: production (and feeding the people) now comes at the end of the round, once everyone is done and before the events, instead of at the start of the round. A round starts with what you have left, and resources can still be spent on the events. The first round now starts with only the starting resources.

## v1.73.3 (combined app)

- Dawn: fourteen more event pictures (batches D and E, partial).

## v1.73.2 (combined app)

- Dawn: pictures for all minor wonders and the City State (card and land), and for nine prehistoric events (batches B and C so far).

## v1.73.1 (combined app)

- Dawn: pictures for the three new techs and six response cards (batch A).

## v1.73.0 (combined app)

- Dawn: the event pop-up shows how much of the asked-for resource you have ("Costs 2 Food · You have 1 Food", red when short), your resources, and the cost on each response button.

## v1.72.2 (combined app)

- Dawn: pictures for the Granary Reserve, Priests and Quarantine response cards.

## v1.72.1 (combined app)

- Dawn: a picture for the Fertile Delta.

## v1.72.0 (combined app)

- Dawn: lands have pictures now (Plains, Mountains, Steppe, Jungle, Coast, Forest, Ocean, Rich Land, Fortified Land, Wondrous Land): on the realm and lands-to-settle cards and in the starting-land popup. Fertile Delta and the City State still need one.
- Dawn: the Game log button now only shows once a game has started.

## v1.71.5 (combined app)

- Dawn: pictures for twelve more action cards (the rest of the prehistoric ones and the Ancient era actions).

## v1.71.4 (combined app)

- Dawn: pictures for ten prehistoric action cards.

## v1.71.3 (combined app)

- Dawn: pictures for nine more techs (Agriculture, Bronze Working, Writing, Masonry, Medicine, Currency, Calendar, Code of Laws, Horseback Riding).

## v1.71.2 (combined app)

- Dawn: a new picture for Stone Tools.

## v1.71.1 (combined app)

- Dawn: pictures for eight prehistoric techs (Fire, Stone Tools, Hunting, Animal Husbandry, Pottery, Mysticism, Spearmen, Herbalism).

## v1.71.0 (combined app)

- Dawn: The First Religion is now +2 culture per turn and temples cost 1 less production (the -1 action is gone).
- Dawn: bonuses (minor wonders) can be removed with a Remove button, after an "Are you sure?" popup; the card goes with it.
- Dawn: wonders of earlier eras cost upkeep: 1 production per round for each era they are removed from, for each player. Wonders of the current era cost nothing. Your realm panel shows what you pay.
- Dawn: new card kind, City State: one waits in every era deck; when picked it goes among the lands to settle and costs 3 influence per player (no people or troops). It gives +2 village slots and +1 culture per turn.
- Dawn: each era deck now holds 6 + players techs.
- Dawn: "Spear Men" is now "Spearmen".
- Dawn: new techs Wanderlust (one more land to settle), The Wheel (settling costs 1 less population) and, in the Ancient era, Ancients Customs (halves the upkeep of wonders from earlier eras).

## v1.70.0 (combined app)

- Dawn: admins get a "Complete (admin)" button in the top right corner of every great wonder under construction; it finishes the wonder at once, in the territory chosen on the card.
- Dawn: a "Game log" button in the header downloads a detailed JSON journal of the game: every action (with the player's resources and actions before and after, and refused actions with the reason), every log line, and a full table snapshot at the start of each round and at the end. Send it after a game for review.

## v1.69.0 (combined app)

- Dawn: your great person now has its own panel above the tribe, with its card.
- Dawn: when you draw a great person while you already have one, you choose whether they replace the current one (undecided at the end of your turn keeps the current one).
- Dawn: the "give at least one resource" error on great wonders now says what the wonder still needs.

## v1.68.0 (combined app)

- Dawn: when the era deck runs out while cards are being drawn (the queue refilling, a blind draw, the face-down card), the next era begins at once and drawing goes on from its deck. The cards already in the queue stay. As at any era end, unfinished great wonders are lost (half returned) and great people leave. In the last era nothing changes: it goes on until the queue is empty at the end of a round.

## v1.67.2 (combined app)

- Dawn: The First Farms becomes obsolete after the Ancient era. (Ancient is the last era for now, so this only matters once a later era exists.)

## v1.67.1 (combined app)

- Dawn: "Actions left" has its own highlighted box in the top bar (it used to share a spot with "Events"; that spot now says Events / Your turn / waiting). The Tribe panel shows how many actions each player has left this round.

## v1.67.0 (combined app)

- Dawn: pictures for all 10 great wonders, shown on the wonder cards in the queue, the "Great wonders" board and the All cards list.

## v1.66.3 (combined app)

- Dawn: new picture for The First Architect.

## v1.66.2 (combined app)

- Dawn: new picture for The First Conqueror.

## v1.66.1 (combined app)

- Dawn: on cards with a picture, the text now sits at the bottom, on the dark part of the picture.

## v1.66.0 (combined app)

- Dawn: cards can have a background picture. A card shows `dawn/cards/<id>.jpg` behind its text (darkened so the text stays readable) if the file exists, in the queue, your hand, pop-ups and the All cards list. The 14 great people have pictures.

## v1.65.2 (combined app)

- Dawn: the "All cards" window starts with a table of how many cards there are of each kind: different cards, copies in each era's list, and how many a deck takes (with the total).

## v1.65.1 (combined app)

- Dawn: the Wondrous Land now carries a real great wonder of the era that is not in the game yet (not built, not being built, not in the deck or queue). The wonder is built, with its bonuses and points, the moment the land is settled; face-up it shows which wonder it is. The land's own made-up bonuses are gone.
- Starting lands: the realm always starts with 2 lands. They are drawn from the lands the players chose (more are drawn from the deck if fewer than 2 were chosen); all other lands, chosen or not, go on top of the land deck in random order.

## v1.65.0 (combined app)

- Dawn: the game now starts with a pop-up where each player is offered two lands and keeps one. The chosen lands are the realm's start (one per player); the others go back into the world deck. AI players choose by themselves and a player who is away gets the first land.
- New event card, Wondrous Land: an event land with a wonder on it (+1 farm slot, +1 mine slot, +2 culture, +2 research per turn). It costs 6 food, 6 production and 1 settler per player (4 more food and production than an ordinary land) and starts with +4 enemy strength.
- "Leaders" are now called great people in the game.
- New Ancient great person, Archimedes: +1 research per turn, and your next technology is played for free (once).

## v1.64.0 (combined app)

- Dawn: Herbalism also gives +1 research per turn. Spear Throwing is now Spear Men: every troop counts for +1 more strength, but training one costs +1 production and each troop eats half a food per round (rounded up per player; shown in your per-round income and the Train button).
- Jungle and Fertile Delta are unhealthy: while held, each takes 2 off Health (it can't go below 0). Health starts at 2.

## v1.63.4 (combined app)

- Dawn: Göbekli Tepe no longer gives +2 research. The First Architect no longer costs 1 food per turn (just +1 action per turn).

## v1.63.3 (combined app)

- Dawn: a balance simulation for development (`BalanceSim`, skipped in normal test runs): bots play thousands of games and it ranks which leaders, techs, wonders and actions go with winning. Run with `mvn -q test -Dtest=BalanceSim -Dbalance=1`. No gameplay change.

## v1.63.2 (combined app)

- Dawn: era decks hold 24+2X action cards (was 18+2X), 9X+41 cards in all.

## v1.63.1 (combined app)

- Dawn: the pick-time countdown is now shown as the queue's background darkening from right to left (hover for the seconds left), instead of text.

## v1.63.0 (combined app)

- Dawn: each era's deck now holds a set number of each kind of card (X = players): leaders X+1, great wonders X, minor wonders X+1, hostility X, techs X+2, actions 18+2X, responses X, events 12+X, and 1 era-trigger event (9X+35 cards in all). The cards are drawn at random from that era's list; if a list is shorter than the number needed, great wonders and hostility cards stop at what exists and other kinds go round again.
- New leaders: Prehistoric: The First Ruler, The First Conqueror, The First Architect. Ancient: Tomyris, Alexander the Great.
- New great wonders (Prehistoric): Göbekli Tepe, Ġgantija Temples, Skara Brae.
- New minor wonders: The First Farms, The First Mine, Oral Tradition, The First Religion (Prehistoric; fades after it), The Great Tomb, The Epic Wall, The Great Trade Route (Ancient).
- New effects: growing costs less food, great-wonder contributions count double, income per territory, minor wonders that go obsolete, enemy strength halved or zero on lands, extra slots per building type.

## v1.62.0 (combined app)

- Dawn leaders reworked. Prehistoric: The First Shaman (+1 culture/turn, temples cost 1 production), The Great Hunter (+1 food/turn, +1 max farm slot), The Storyteller (an event leaving the queue gives you the face-down card under it), The Great Mother (hand size -2, action cards leaving the queue go to your hand). Ancient: Julius Caesar (+1 military strength per 2 troops, for you), Gilgamesh (first troop each round takes no action, +2 military strength), Hammurabi (+1 research/turn, +1 hand size), Ramses (every unfinished great wonder gains 1 of each resource it needs, every round).
- Buildings above what the land allows (a lost territory, a leader leaving) now stay but are inactive: their workers produce nothing and no one can be moved in until there is room again. Before, they shrank.

## v1.61.0 (combined app)

- Dawn: a new card type, leaders. A drawn or picked leader plays itself at once, replaces your current leader and leaves when its era ends. Shown beside your realm and in the "All cards" list.
- Prehistoric: Gilgamesh (the first troop you train each round takes no action) and Hammurabi (+1 research per turn). Ancient: Julius Caesar (every 2 troops at home give +1 raid defense).

## v1.60.0 (combined app)

- Dawn: an "All cards" button at the far right of the header lists every card, land and great wonder with what it does.

## v1.59.1 (combined app)
- **Dawn of Mankind: New Trading Route** now works as a choice: pick a teammate, then either pay 1 food so they get 2 production, or pay 1 production so they get 2 food. It is a two-or-more-players card (`minPlayers: 2` on a card keeps it out of the deck in solo games).
- **Two boxes instead of one:** *Technologies* (the technologies) and *Bonuses* (minor wonders such as Roman Roads), between *Event decks* and the log. New Trading Route is an action card and is used from the hand, so it doesn't show in either box.

## v1.59.0 (combined app)
- **Dawn of Mankind: science scores.** Every technology card played gives +1 point (in the final score, together with wonders and territories).
- **Great wonders are cheaper**: every cost reduced to 3/3.5 (about 86 %), rounded (e.g. Stonehenge 12 production + 4 culture per player is now 10 + 3).
- **The game ends later:** in the last era it no longer ends when the era deck runs out; it goes on until the queue is empty at the end of a round (earlier eras still move on when their deck runs out).

## v1.58.0 (combined app)
- **Dawn of Mankind: parallel rounds.** There are no turns now: every player has their own 4 actions each round and acts at the same time, in any order. Everyone draws their blind card as the round starts. A player presses *Done for the round* (hand within its limit); when everyone is done, the events come, as before. First click wins when two players take the same card.
- **The card queue keeps its gaps.** A taken card leaves an empty (dotted) slot; nothing slides down during the round. At the end of the round the last slots leave (an empty one loses nothing, and the red ✕ cards are exactly those about to go), the gaps close and the queue is refilled.
- **Pick time.** The queue can be picked from for 90 seconds after the round starts, then it is closed until the next round (a countdown shows it). Anyone can change the time during play (0 = no limit); setting it to less than has already passed closes the queue at once.
- **Every drawn event shows.** An event that resolves at once (no response cards, nothing to decide, e.g. Flash Flood) now pops up for every player with what it did, instead of passing by unseen in the log.
- **Round start pop-up:** at the start of every round a box says it is your turn (round number) and shows the card you drew.
- **Temples make 2 culture per worker** (was 1).
- **Strength in the tribe panel:** *Army Y (strength X)* for each player (when technologies add strength), and a line for the whole tribe: total army and total strength against an invasion (everyone sending all their troops, plus any invasion defense).
- **Settling a land costs the troops sent:** all troops sent against a land's enemy strength are lost (was half, rounded up). Invasions are unchanged.
- Away players are marked done automatically; AI players pick from the open slots. Changed in the combined app's copy only.

## v1.57.12 (combined app)
- **Dawn of Mankind: cards that leave the queue are marked with a red ✕** (besides the dashed border).

## v1.57.11 (combined app)
- **Dawn of Mankind: you choose who starves.** When food runs short and your people are in more than one place (idle, or in different buildings), the new round waits and a box asks how many of the starving come from where. If everyone is in one place, or you are away, it happens by itself as before (idle people first, then the fullest building). AI players let idle people go first. New game phase `starvation`, action `starve`.

## v1.57.10 (combined app)
- **Dawn of Mankind: the card you draw at the start of your turn pops up** (with a note if events came up first and went face down). Shown once per turn, also after a reload.
- **Cards that bring a person ask where they work** too (e.g. Gather the Tribe), when more than one building has a free slot, like *Grow*.

## v1.57.9 (combined app)
- **Dawn of Mankind: paying toward colonies and great wonders is free** (no action; it must still be your turn). Choosing a wonder from the queue and playing a Settle card to open a face-up land as a colony still cost actions. AI players pay toward each wonder and colony at most once a round. Changed in the combined app's copy only.

## v1.57.8 (combined app)
- **Dawn of Mankind: what each building makes.** Every building in *Your people* shows, at its right, what it produces each round as things stand (its workers times the per-worker amount, technologies and wonders included); hover for the per-worker numbers. Changed in the combined app's copy only.

## v1.57.7 (combined app)
- **Dawn of Mankind: Plains** now reads "+2 max farm slots". Changed in the combined app's copy only.

## v1.57.6 (combined app)
- **New event "Civil War" (Dawn of Mankind).** A random core territory loses its core status; with no core territory, a random territory is lost instead. In the Ancient event deck. New effect `civilWar`. (The realm is shared by the whole team, so "your" core means the team's.) Changed in the combined app's copy only.

## v1.57.5 (combined app)
- **Dawn of Mankind: the face-down card pops up.** Taking on an event shows the face-down card you got in a pop-up.
- **Dawn of Mankind: technologies box.** The technologies researched so far are listed (name, who researched it, what it does) in a box between *Event decks* and the log. Both changed in the combined app's copy only.

## v1.57.4 (combined app)
- **Dawn of Mankind: choose where the new person works.** *Grow* asks which building gets the new worker when more than one has a free slot (with one, it goes there as before). The game accepts an optional `building` on the grow action. Changed in the combined app's copy only.

## v1.57.3 (combined app)
- **Dawn of Mankind: A Long Day is now +3 actions** (it costs 1 to play, so +2 in all; it was +2, a net +1).
- **New event "Free Colony".** A land from the territory deck becomes a colony at once, with nothing paid; anyone can then settle it (1 action each), like a Settle-card colony. One in each era's event deck. New effect `colony: n` in the card file. Changed in the combined app's copy only (the same changes are needed in the dawn-of-mankind repository).

## v1.57.2 (combined app)
- **Dawn of Mankind: events pop up.** An event that strikes now opens over the board with a dark backdrop (the card, what it will do, response cards, Accept/Decline, troops), so it can't be resolved without looking at it. Land the event finds shows in the same pop-up, ready to pay for. *Look at the board* hides it for that event (a *Show the event again* button brings it back); a new event pops up again. Changed here in the combined app's copy of the page only (`META-INF/resources/dawn`): the same change needs making in the dawn-of-mankind repository.

## v1.57.1 (combined app)
- **Dawn of Mankind updated** to the newest `main` (`49326c9`): AI players the host can add in the lobby, settlers and colonies, global techs, lasting crises, new cards. Setting `dawn.ai-move-millis` (default 900) is the pause before an AI player's move.

## v1.57.0 (combined app)
- **Dawn of Mankind added as a third app** at `/dawn/`: the co-operative card game (1–6 players, rooms with a 5-letter code, live over a WebSocket), copied in from `gemstone86/dawn-of-mankind` main (`49326c9`: rules engine, AI players, web part and page; sources under `com.dawnofmankind`, cards in `dawn/content.yaml`). Logged-in players play under their account name, guests type one. New tile on the start page; its API is covered by the same-site check. Games run in memory, so each deploy ends the games in progress.
- **Azure: turn on Web sockets** for the App Service (Configuration → General settings), or the rooms won't connect.

## v1.56.0 (combined app)
Weather generator:
- **Blocked way: ask to reroute.** When the weather (deep snow, storm) makes a stretch too slow to walk (under *Blockerad väg*, default 0.5 km/h; 0 turns it off), the journey notes where it gets blocked. When the clock reaches that point, a box asks whether to plan a new route from where the party is (it opens the usual *Ändra resa* from there, planned for the conditions of that day) or to carry on. Asked once per blocked stretch, for your own journeys.

## v1.55.0 (combined app)
Weather generator:
- **Rak väg.** A journey option that turns off the wiggle: the route follows the best path without the small bends and meanders. Saved with the journey.
- **Waypoints as a list you can sort.** Each waypoint has ▲ ▼ buttons; moving one plans the route again.
- **Rename a journey** (*Byt namn…* on your own journeys).
- **Stops and delays on the journey.** A saved journey has a list of its stops (start, waypoints, end) with km, and every försening is marked in it at the place along the route where it happens.
- **Flytta floder m.m.…** moved from the map-layer list to the river tools bar (admins, standard map).
- **Spring flood.** Rivers carry more water in their region's spring months (3–4 north, 9–10 south of the middle of the map): fords there cost more time. The rise is a travel rule (*Vårflod*, default +50 %).

## v1.54.1 (combined app)
Weather generator:
- **Journey hours are local time at the start.** The daily travel hours (and the first day's start) are the local time at the place the journey starts, kept for the whole journey (the party doesn't change time zone on the way). The departure moment typed in the form is now turned from local time into the app's clock the same way, so *Resa varje dag från kl 08:00* leaves at 08:00 local time, however far east or west the start lies.

## v1.54.0 (combined app)
Weather generator:
- **Daily travel hours as clock times.** The journey form now has *Resa varje dag från kl* and *… till kl* (HH:MM, shown from the rules' start and hours a day), replacing the day start and the hours a day. A time to the next morning (e.g. 20:00 to 04:00) works too.
- **First day of its own.** Tick *Första dagen börjar annorlunda* and give a time: the first day the party travels from that time (to the same end time, e.g. 15:00 to 18:00) and every later day from the daily start (e.g. 08:00 to 18:00). The journey leaves at that time on the start date (the calendar's date, or the *Startdatum* typed), and the arrival times, the nights in cities and the route's times all follow it. Journeys made before keep their own hours.

## v1.53.0 (combined app)
Weather generator:
- **Lättast and Säkrast keep out of the mountain ranges.** The marked mountain ranges now cost more to cross off the roads: the area of a range (its crest line with the width lines drawn to each side) costs extra, and the cells the crest line itself runs over cost more still. The defaults are **+100 % in the range and +300 % on the crest** (more than the +25 % / +50 % that were asked for as a minimum, which still lets a long range be crossed when the way round is long); both can be changed in the travel settings (*Bergskedja: extra kostnad…*, saved for everyone with *Spara för alla*). Roads and paths keep their passes, *Snabbast* and *Kortast* are not affected, and the routes' rounding-off and meander no longer cut into a range that was gone round. The time of a Säkrast journey is still its real walking time.

## v1.52.0 (combined app)
Weather generator:
- **Start date for a journey.** The journey form has *Startdatum (dag/månad år)*, filled in with the calendar's date: change it to plan a journey that starts on another day (at the day's start hour). The routes, the fords that are open in that month, the snow and the weather along the way are worked out for that date; *Nu* puts the calendar's date back. A journey that starts later is shown from its start date as usual.

## v1.51.0 (combined app)
Weather generator:
- **Choose what *Dra…* grabs.** Next to the buttons there is *Dra:* with *hela flodsystemet* (as before), *bara en flod* (just the one you press on) and *floden och bifloderna* (it and the rivers that run into it, recursively). Rivers that run into a single moved river keep their meeting point on it; a moved river's own mouth stays where the river it runs into is, so fix that end with the river tool if needed.

## v1.50.0 (combined app)
Weather generator:
- **Drag takes the whole river system.** Pressing on a river with *Dra…* now picks that river and everything connected to it: the rivers that run into it, the river it runs into (and their tributaries), and the lakes between, so a whole river system moves together and keeps its joins. A click without pulling drops the system again.

## v1.49.0 (combined app)
Weather generator:
- **Drag rivers with the mouse.** *Flytta floder m.m.…* has a new *Dra…* button: press on a river (it is picked if it wasn't) and pull; all the picked rivers follow the mouse while you pull and are saved in the new place when you let go. A click without pulling picks or drops a river; pressing on empty ground pans the map as usual. A drag is one step in *Ångra*, so it can be undone, and the arrows and the size buttons can still be used afterwards for exact placing.

## v1.48.0 (combined app)
Weather generator:
- **Undo a move.** *Flytta floder m.m.…* has *Ångra (n)*: it takes back the latest move (up to 30 steps, one per arrow press or *Flytta*), also a scaling, and for a box also the height, forest and marsh pictures inside it. Only what the move changed is put back: anything you drew or edited in the rivers, roads etc. since stays as it is. The steps are kept in the server's memory, so they are gone after a restart or a new release.

## v1.47.0 (combined app)
Weather generator:
- **Scale rivers like a layer.** *Flytta floder m.m.…* also has *Storlek* (%) with − / + (steps of 0.05–1 %): picked rivers (or the lines and places in a box) are scaled and then moved. *Lika mycket som lagret* now fills in the layer's move **and** its size, and the scaling is about the middle of that layer's pieces, exactly as the layer itself is scaled, so rivers drawn on a layer follow it. Without a layer the scaling is about the middle of the picked rivers (or the box). The pictures (height, forest, marsh) can only be moved, not scaled.

## v1.46.0 (combined app)
Weather generator:
- **Route kinds in a drop-down.** The suggested routes (fastest, easiest, shortest, safest) are now chosen from a drop-down, with the chosen one described below it; clicking a route on the map still chooses it.
- **Drag the stops of a saved journey.** With the travel panel open and one of your journeys chosen, its waypoints (numbered) and its end are shown and can be dragged straight on the map: the journey goes into *Ändra resa* with that stop in hand, and the rest is planned again when you let go (then *Spara ändringen* as before). A waypoint already passed can't be moved.
- **Move rivers etc.:** *Lika mycket som lagret* now lists every map layer (also those that haven't been moved, such as Gordrion, Vambolien & Caserion), for taking a layer's move as the number to move by.

## v1.45.0 (combined app)
Weather generator (admins, standard map):
- **Move what is drawn without changing its shape.** In the map-layer list there is *Flytta floder m.m.…*, a window beside the map. By default you **pick rivers** by clicking them (click again to drop one; they turn gold), and the arrows ◀▲▼▶ move the picked rivers **at once**, in steps of 0.02, 0.05, 0.1, 0.25, 0.5 or 1 map pixel, so they can be placed exactly and independently of the map layer below; the opposite arrow undoes a move. Numbers can also be typed, or taken from a layer's own move (*Lika mycket som lagret*, e.g. Jargien).
- Or choose **Allt i en ruta**: drag a box and move everything in it together: rivers, roads, mountain ranges, cities and the height, forest and marsh maps (pictures are moved smoothly, so a half pixel is a half pixel; outside the box they are as before). Saved for everyone at once.
- A picked river that runs into one that isn't picked keeps its meeting point on that river, so its last point may come to lie a little beside it; drag it back with the river tool.

## v1.44.0 (combined app)
Site:
- **Visitor counts on the admin page.** *Admin* now has a *Visitors* section: how many different visitors and page views each day had (the last 30 days), in total and for the start page, Root and Rune and the weather generator. It is counted inside the site, without cookies and without storing anyone's address: a visitor is a short code made from their address and browser mixed with a random salt kept only in memory and thrown away at midnight (UTC), so nobody can be followed between days or traced back. Only the daily numbers are saved (table `visit_stats`, kept about two years).
- Only page loads count (not the API, scripts or images), and robots and browsers that send Do Not Track / Global Privacy Control are left out. A visitor is counted once per day (and once more if the server restarts that day); the per-page figures can add up to more than the total, since a visitor to two pages counts in both.

## v1.43.0 (combined app)
Weather generator:
- **Detours.** Next to *Lägg till mellanpunkt* there is *Lägg till avstickare*: click the route where the detour branches off, then click the place to visit. The journey goes from that point to the place and **back** to the route, then carries on; each stretch is found with the same rules as the rest. Detours are orange on the map (a diamond where it branches off, a dashed line to the place) and can be dragged like the other points. In the list, ↩ on a detour turns it into an ordinary waypoint that carries on forward, and ⤺ on a waypoint makes it a detour.
- **Change a saved journey.** Your own journeys have *Ändra resa…*: the part already travelled stays, and the rest is planned again from where the token is now, with the start (the token), the end, waypoints and detours all draggable, and all four route kinds available. *Spara ändringen* replaces the journey's route, keeps its delays and events settings, works out the new arrival and saves it; journeys keep their waypoints (`via`) so they can be changed again.
- Fix: a saved journey no longer carries its cached town list in the data it saves.

## v1.42.0 (combined app)
Weather generator:
- **Drag the start, the end and the waypoints.** Once a journey's routes are shown, grab the green start, the red end or a numbered waypoint and move it; the routes are found again when you let go. If no route reaches the new place the point goes back and you get the "no way over land" message instead of losing the plan.

## v1.41.0 (combined app)
Weather generator:
- **Waypoints on a journey (mellanpunkter).** Once the routes for a journey are shown, *Lägg till mellanpunkt* lets you click the map to add waypoints: the routes are found from the start through the points, in order, to the end, each stretch with the same rules as before (Snabbast, Lättast, Kortast and Säkrast, with the ferry, sea and mount choices), and the totals are for the whole way. A new point is put in the order the chosen route passes the points. Points are numbered on the map and listed as chips with ✕; right-click a point on the map to remove it (right-click elsewhere ends adding). If a point can't be reached it is taken away again with the message. Saved journeys keep the whole route as before.

## v1.40.0 (combined app)
Weather generator:
- **Fix: Cancel in the travel settings.** *Avbryt* (and *Återställ*, *Händelseregler…*) failed with a complaint about a value that could not be set, because the number boxes only accepted multiples of 0.05 and the browser checked them before closing. The number boxes accept any value now, and the buttons that don't save skip the check.
- **Jargien fitted to the first map.** Measured against the first Mundana map, Jargien lay about 1.5 map pixels too far south (up to 3–4 in its north part, where the rivers jump at its north edge) and half a pixel too far east; its size agrees within 0.5 %, so it is only moved: 4 full-size pixels left and 12 up (a layer move, undoable with ⟲).

## v1.39.1 (combined app)
Weather generator:
- **Consaber re-fitted to Thalamur (Egor) along the join.** Measured on the strip where the two maps overlap (the roads and names near Consaber's west edge, where Qatada, Svrox and Ivani are), Consaber needs to lie about 8 full-size pixels left and 18 down from Thalamur, not 4 and 12. Its move is now 16 right and 2 up (Egor's move plus that). The two are drawn differently (names and roads are placed differently, and the pictures only agree to about 1 map pixel), so they can be made to meet at the join but not to be identical.

## v1.39.0 (combined app)
Weather generator:
- **Egor and Consaber fit their neighbours.** Where the layers overlap (Gordrion–Egor around the Qatada region, Egor–Consaber around Coloniska sjön) the names and coasts lay a few pixels apart and showed double. Fitted against each other (no layer was off in size: Egor and Consaber are within 1 % of the first map): **Egor** is moved 24 full-size pixels right and 20 up to match Gordrion, and **Consaber** 20 right and 8 up (its fit to Egor, 4 left and 12 down, on top of Egor's move). They are shipped as layer moves in the release (`layerShift`, with `layerShiftRelease` so they are installed over what is saved in the app), not as new zoom pieces, so an admin can tune or undo them with the arrows and ⟲ in the *Kartbild* list.

## v1.38.0 (combined app)
Weather generator:
- **Transparent map layers (admins).** Under each layer in the *Kartbild* list there is a *Genomskinlig* slider, 0 % (solid) to 100 % (invisible) in steps of 5, so a layer can be seen through when fitting it against the one below. It applies to the zoom pieces and the map picture alike, is saved for everyone (`settings.layerTransparency`, `PUT /maps/{id}/layer-transparency`) and stays over new releases unless the release says its own is newer (`layerTransparencyRelease`, set by `tools/apply-export.py`). `map-layers.json` has each layer's `transparencyPercent`. Remember to set it back to 0 % when you are done.
- Tests: `LayerShiftTest` also covers this.

## v1.37.0 (combined app)
Weather generator:
- **Scale a map layer (admins).** Next to the arrows in the *Kartbild* list each layer has *Storlek* with **−** and **+**: one step is 0.5 % (Shift: 1 %), from 80 % to 125 %. A layer is scaled about the middle of the area its pieces cover, so combine it with the arrows to put it right. Like the move it is saved for everyone (`settings.layerShift` is now `[dx, dy]` or `[dx, dy, scale]`; `PUT /maps/{id}/layer-shift` takes an optional `scale`), and ⟲ puts both back. `map-layers.json` has each layer's `scale` and `box` (its middle and size).

## v1.36.0 (combined app)
Weather generator:
- **Move a map layer (admins).** In the *Kartbild* list, every layer has a row of arrows for the admins: each click moves that regional map one map pixel (8 full-size pixels), Shift-click eight map pixels, ⟲ puts it back. It moves the zoom pieces and the map picture alike, is saved for everyone (`settings.layerShift`, `PUT /maps/{id}/layer-shift`) and stays over new releases unless the release says its own is newer (`layerShiftRelease`, set by `tools/apply-export.py`; the admin export carries it as a changed setting). The 3D view does not use the moves yet.
- **Export map layers (admins).** A button at the bottom of the list downloads `map-layers.json`: order, each layer's box, move and the zoom pieces it has, so it can be sent along for fitting.
- Tests `LayerShiftTest`.

## v1.35.0 (combined app)
Root and Rune:
- **Missing words from texts.** The *Missing words* tab has a new list, *Needed by texts*: meanings that the language's texts (its own and the ones it inherits) use at any of their years but the language has no word for. Each shows why, which texts and lines need it, and at which years, with the same *Coin word*, *Suggest root* and mark-as-missing buttons as the sentence list. Meanings you have already marked by hand are not repeated. The compound tool's side list shows them too. The list is also in the API as `fromTexts` on `GET /languages/{id}/missing`.
- Tests `MissingFromTextsTest`.

## v1.34.0 (combined app)
Root and Rune:
- **Syllable shapes by year.** Besides the shape from the start, a language can have others from certain years: *Grammar → Syllable shape → Other shapes by year*, one per line, `500: CV(C)` (the owner edits them). A shape is in force from its year until the next one; for a year before all of them the shape from the start is used, or, without one, the earliest. A language without any shapes goes by its parent's, as before.
- **Words that do not fit are marked.** A word's form as it was coined must fit the shape in force in its coin year (the nearest one in time); one that does not gets a problem line in the dictionary (*does not fit the syllable shape CV(C) (from the start, Elven): pant*), so it shows with the other problems and under *Only problems*. Cross-references, borrowed words and literal forms are not checked.
- **Roots for a year.** *Suggest new roots* has a *year* box: the roots get the shape in force in that year, and are learnt from the words coined by then (as they were entered). Next to it a line tells which shape that is and where it starts (*Syllable shape for year 900: CV(C)(C) (from year 500)*); without a year it is the latest shape. The Claude connector's *rune_suggest_roots* takes a year too.
- **Export JSON.** A button beside *Export Excel* downloads every word of the language as a JSON file: id, gloss, type, build, year, form, romanization, pronunciation, notes, tags, where it was coined (for inherited words), the latest form per branch and its forms.
- New column `languages.syllable_years`; tests `SyllableYearsTest`.

## v1.33.1 (combined app)
Weather generator:
- **Windows taller than the screen scroll, and their buttons stay in view.** The journey settings window (and the other windows: event rules, the symbols, the small question boxes) could be taller than the screen on a low or narrow window, with its *Save* / *OK* buttons off the bottom and no way to scroll. Every window now scrolls inside the screen's height and keeps its row of buttons at the bottom.

## v1.33.0 (combined app)
Weather generator:
- **"Last edited" on roads, rivers, lakes, cities, bridges, fords, mountain ranges and nations.** Every item of these lists now remembers when it was last changed and by whom. When a list is saved the server compares it with what was stored: the items that are new or different (renamed, moved, a point changed, …) get the time (UTC) and the account's name, the ones that are the same keep what they had. The information line of the selected item ends with it, in the page's language: *… · last edited 17 Nov 2026 07:55 by boss* (for a nation it is the nation as a whole; changing one of its subdivisions counts as changing the nation).
  - Items that nobody has changed since this version (including everything the standard map ships with) show nothing until they are edited. Painted layers (forest, ice, marsh) and the height map are images, so they have no per-item date.
  - The lists carry `edited` and `editedBy` in their JSON (so the downloaded `.json` files and the map export have them too); the answers of the list endpoints also have `stamps` (`{ id: [time, account] }`), and the version check (`rev`) goes by the stored list, stamps included.
  - New `ListStamps`; tests `ListStampsTest`, `LastEditedTest`.

## v1.32.0 (combined app)
Root and Rune:
- **Romanization column.** A word has a new optional field, *romanization* (the word written in the Latin alphabet), with its own column in the dictionary (after *Form*), a box when adding a word, in the edit row of the word window, and a filter box in the dictionary's filter row; the free-text search finds it too. Bulk entry takes it as a seventh column (`gloss;type;form;year;notes;tags;romanization`), the Excel export has a *romanization* column and the Excel import reads one of that name. It is kept in the full export. It is only for display and search: the sound changes and the forms still work on the *Form*. Up to 400 characters.
- **Hide columns.** *Columns* above the dictionary table has a tick box for each column (the gloss always stays); what you hide is remembered in the browser. Only how the table looks; nothing else changes.
- New column `words.romanization`; test `RomanizationTest`.

## v1.31.0 (combined app)
Root and Rune:
- **Ask for access with a link.** Someone who is logged in and opens a link to a language they cannot see (`/rune/?lang=…`) now sends a request to the language's owner (and the world's owner) instead of just being told it was not found. The owner gets a notification under the bell, and on the language's *Sharing* tab a box *Asking for access* lists the requests with *Let in as viewer*, *as editor* and *Deny*; letting someone in shares the language with them like the usual sharing does (they get a notification), and a *Deny* tells them no. One open request per person and language, at most 20 open per person.
- **No account yet.** A visitor who is not logged in is sent to the log-in page with a note that the language is not public and that they can log in to ask for access, or create an account first, and is brought back to the link afterwards, which then sends the request. Only people with an account can ask, so only they can be let in.
- New table `access_requests`; test `AccessRequestTest`.

## v1.30.0 (combined app)
Root and Rune:
- **Link to a language.** A *Copy link* button next to *Export Excel* copies a link (`/rune/?lang=…`) that opens that language. A public language opens for anyone; a private one opens for the people it is shared with. Someone who is not logged in and follows a link to a language they cannot see is sent to log in and then brought back to the same link.

## v1.29.3 (combined app)
Weather generator:
- **The Asharien & Damarien layer moved a little to the left.** Fitted against the first Mundana map it sat about 1.3 map pixels (10 full-size pixels) too far to the right; the scale was right. It is moved 10 full-size pixels left with `tools/move-layer-piece.py`. The fit also suggests it could go about one map pixel north; that is left as it is.

## v1.29.2 (combined app)
Weather generator:
- **Caserion fits the map better.** The Caserion part of the layer *Gordrion, Vambolien & Caserion* was drawn about 4 % smaller than the first Mundana map and sat a few pixels too far south, which is why the south fitted and the north drifted. It is now scaled up 4 % (the north and south halves gave the same scale when fitted) and moved so that its north edge is about 5 map pixels further north; the place names now fall on the first map's. New tool `tools/scale-layer-piece.py` (like `move-layer-piece.py`, with a scale).

## v1.29.1 (combined app)
Root and Rune:
- **Slower speech by default.** The speech engine's default speed goes from 140 to 105 words a minute. A language that has its own speed set (*Settings → Speech → Speed*, 60–400) keeps it; an empty field uses the default, or the parent language's speed.

## v1.29.0 (combined app)
Root and Rune:
- **Edit a word in the word window.** Clicking a word now has an edit row just above the forms table (gloss, type, build, form, year, notes, tags and *Save word*), so a word can be changed and checked in the same place. Only what was changed is saved, through the same edit as the dictionary's, so it is in the edit log and can be undone.
- **Evolution tree: changes close together no longer overlap.** The tree places each change by order, not by year: changes in different years get their own column even when the years are one apart, several changes in the same year are put side by side, and a column is as wide as the form and the rule name written in it needs. Branches still line up by year.
- **Sort a group's rules in Word forms.** Each rule in a group has ▲/▼ buttons (editors and owners) that move it one place up or down within the group, to make the list easier to read. This is only how the rules are shown (new column `form_rules.show_ord`): which rule is used for a word, the *Order* column and the forms that are built are not touched.

## v1.28.0 (combined app)
Root and Rune:
- **Form rules can take the word's old ending off first.** A new optional field on a form rule, *first remove from the end of the word* (a pattern written like a sound change's, e.g. `(aną|ōną|ą|az)$`), is applied to the word before the ending is added (from the start of the word for a prefix). Before, the ending was glued on the whole dictionary form, so the word's old ending sat in the middle of the new form (*ēþmijanąida*), where the sound changes that remove it from the end of a word (`ną$`, `ą$`, `z$` …) could no longer match; the plain dictionary form went through them, the built forms did not. With the pattern: *ēþmijaną* + *-ida* → *ēþmijida*, *atganganą* + *-ida* → *atgangida*, *þeudą* + *-az* → *þeudaz*, at any start year (no need to set the rule's year after the ending-loss rules).
  - Only a match that touches the edge counts (the last one for a suffix, the first for a prefix); no match, or a match of the whole word, leaves the word as it is. A pattern that does not compile is refused when the rule is saved.
  - Used for the forms the rules give (dictionary, word window), for forms built in sentences and tables of endings (also when endings are stacked: the pattern is applied to what stands before each ending is added) and for the check for irregular forms. Forms already stored (irregular, made by hand, or stored by *Store irregular forms*) keep what they have: *Rebuild all* on the rule recomputes them.
  - New column `form_rules.strip_re`; shown on the rule's row as *remove …*; in the Excel export as *remove from the end first*.

## v1.27.0 (combined app)
Root and Rune:
- **Tags on words.** A word can have tags (comma-separated, like the sound changes'): a *tags* box when adding or editing a word, shown as small labels after the word in the dictionary (click one to show only the words with it), and a *tag filter* in the dictionary's filter row (several tags: the word must have all of them; the free-text search finds tags too). Tags are kept in the full export and in the Excel export (a *tags* column at the end).
- **Bulk entry can tag every word.** The Bulk tab has *tag for all these words*: every word added gets it. A line can also have its own tags as a sixth column (`gloss;type;form;year;notes;tags`); that word gets both. *Check only* says what would be tagged; a tag longer than 40 characters is refused and nothing is added. The admins' Excel dictionary import has the same box.
- New column `words.tags`; `POST /rune/api/languages/{id}/bulk` takes `tags`, `POST /rune/api/admin/import-elven` takes `tags`.

## v1.26.1 (combined app)
Weather map:
- The standard map is updated from an admin export (Mundana, 15 November): the height map (909 changed pixels, revision 10), the forests, the roads (66) and, new in the standard map, the **cities** (16) and the **marshland**. A server that already has the standard map gets them installed once (the *Release* marks in `map.json`); what was changed in the app since is not touched by the older parts.

## v1.26.0 (combined app)
Root and Rune:
- **Expand a word's forms in the dictionary**: a word that has forms by rule gets an arrow (▸) beside its id. Clicking it lists the forms under the word: the form's name (definite, plural …) stands where the id is, then the word, its type and *by rule* (or *irregular*, *by hand*, *levelled*), the form, its year and its latest per branch. Clicking a row opens the word. There are no ids of their own for forms: every row belongs to the word's id. Words without forms by rule look as before.

## v1.25.0 (combined app)
Weather map:
- A new ford's flood months follow the hemisphere: 3–4 north of the equator (the middle of the map), 9–10 south of it.
- A wagon's speed off the roads can be chosen for a journey: *Vagn utanför väg (%)* next to *Färdsätt* (the settings' value, 80 %, unless you type another).
- A route's small bends no longer dip into full marshland.

From the code review:
- **Passwords** are stored with 600 000 rounds of PBKDF2 (was 120 000), as `pbkdf2$rounds$salt$hash`. Existing accounts are stored again at that strength the next time they log in; nothing to do. (Failed logins were already limited: 10 per username and address in 15 minutes.)
- **Requests from other sites are refused** for every changing request to `/api`, `/rune/api` and `/weather/api` (`SameOriginFilter`: the browser's `Sec-Fetch-Site` and `Origin`). Root and Rune had only the cookie's SameSite setting before.
- **One version number**: `pom.xml`. The pages get it from `/version.js` (filled in by the build), the weather server from the same property. The weather page now shows the app's version (v1.25.0), not its own series (it was at 2.24). No more numbers to bump in `main.js`, `app.js`, `Api.java` or `index.html`.
- The `?v=` numbers on the weather page's scripts are gone: the server already tells browsers to check for a newer copy every time.
- **Tests for the weather page's JavaScript** (`src/test/js`, run with `node --test src/test/js/*.test.js`, and in both GitHub workflows): the travel rules (horse and wagon, nights in cities, bridges and fords, marshland, harbours, Säkrast), the painter's limits (water, tree line), and that every text exists in both languages.
- **Smaller files**: `app.js` (3 600 lines) is now seven files, `app-core.js` … `app-start.js`, loaded in order and sharing one scope (the code is unchanged); `i18n.js` has one text per line (it was a few lines of tens of thousands of characters each).
- **One of each instead of five and three**: the server's handlers and storage for rivers, roads, cities, mountain ranges and nations are one (`Api.ListLayer`, `Store.list` / `setList`), and so are forest, ice and marshland (`Store.painted`); installing them from a release is two loops. `Api.java` −140 lines, `Store.java` −55, `DefaultMap.java` −90. Nothing changes in the API.

## v1.24.0 (combined app)
Root and Rune:
- **Regular forms are no longer stored** (compact forms). A form the rules give is worked out when it is shown (dictionary, word window, sentences, the check for unused sound changes) and comes out exactly as a stored one did: built when it comes into use, then through the sound changes as a whole. The word window marks it *by rule*. Editing one stores it as a form made by hand. Stored forms that are just what the rules give are taken away the next time the forms are rebuilt, or with **Store irregular forms** on the Word forms tab. Nothing changes in what the forms are.
- **Irregular forms from sound changes**: a form is irregular from the year a sound change makes it something else than its word plus its ending, each going through the sound changes on its own: im + tou is *imtou*; "t > b between m and a vowel" makes it *imbou*, while im + tou would still be imtou, so *imbou* is irregular from that year (*akatou* stays regular). The word window shows *irregular since (year)*. Such forms are stored (from their beginning, so the history shows imtou > imbou) by **Store irregular forms**, a rebuild, or when the word is added, and are then left alone when the rule changes. An ending written in the rule itself is followed through the sound changes behind a mark, so its inner edge doesn't count as the edge of a word.
- **Levelling**: in the word window, **Level…** on a form picks a year from which it is regular again: what its rule gives then (the word as it is then with the ending as it is then), going on from there. *Unlevel* takes it away. Sentences, the dictionary and histories follow it.
- **Sound change preview** (*Preview effect*) now also lists the groups of words that would come to sound the same though they don't now.
- **Spelling reforms** (Grammar tab): years of spelling reforms for a language. With them the spelling lags behind the pronunciation: a word is spelled as it sounded at the latest reform (or when coined, if later). The dictionary shows *spelt …* where it differs from how the word sounds now; the word window lists the spelling after each reform. Empty: spelled as it sounds, as before.
- New columns: `word_forms.irregular_year`, `level_year`, `level_form`; `languages.spelling_years`. `POST /rune/api/languages/{id}/forms/level` `{ word_id, label, year }` (owner).

## v1.23.0 (combined app)
Weather map (page v2.24):
- **Ways of travelling**: *Färdsätt* in the travel panel: on foot, **horse** (1.5 times the speed) or **wagon** (walking speed on roads, 80 % of it on paths and open ground). The routes are found for the way chosen (a wagon keeps to roads more) and the journey remembers it. The three numbers are in the travel settings.
- **Nights in cities**: a party that reaches a city on its way with at most 2 hours left of the day stays the night there, and it travels up to 1 hour past the day's end to reach one. The journey's line lists the cities it sleeps in. Both numbers are in the settings (−1 and 0 turn it off).
- **Bridges and fords**: Redigera → *Städer, broar och vadställen* has a *Slag* choice: Stad, Bro or Vadställe. A bridge or ford is put on a river (it snaps to one). A journey crossing the river within 5 map pixels of a bridge doesn't ford; at a ford it doesn't either, except in the ford's flood months (*Översvämmat månad* from–to, 3–4 for a new ford, 0 = never). Roads over rivers are bridges as before.
- **The tree line follows the temperature** (*Följ temperaturen*, on by default): it lies where the warmest month's mean is 10 °C (6.5° colder per km up), never above *Trädgräns (m)*. Cold regions get a lower line; the coldest none at all. *Visa trädgräns* and *Ta bort över gränsen* follow it.
- **City weather**: click a city on the map: its name, population and harbour, the weather there now, and the coming three days (lowest to highest temperature, strongest wind, precipitation). Bridges and fords show their name and kind.

## v1.22.0 (combined app)
- Weather travel, sea voyages: **Landa var som helst** (a third box next to *Havsresa*): the ship may come ashore anywhere, with 4 hours' landing delay outside a harbour (settings: *Landstigning utanför hamn*). Ships also **keep within sight of a coast** when that isn't much further (open sea counts 1.5 times, sight 40 km, both in the settings), and out of sight of land their course **wiggles**, more in a strong wind. The weather page is v2.23.

## v1.21.5 (combined app)
- Weather travel: a sea voyage now also has to **end** in a harbour (it came ashore anywhere before). Where the map has harbours, ships set out from one and come ashore at one; a map with no harbours keeps the old rule. The weather page is v2.22.

## v1.21.4 (combined app)
- Fix: on the standard map, admins couldn't pick *Städer* or *Sumpmark* in the edit list (the options were greyed out: the list of modes open to people who don't own the map didn't include them). The owner and the admins now can; other people still can't (they can't save them). The weather page is now **v2.21** (shown bottom right; the page and the server must match).
- Forest painter: **Visa trädgräns** switch. On, the ground above the tree line is tinted red and the tree line itself is a strong red edge (follows the *Trädgräns (m)* value, default 3000 m).

## v1.21.3 (combined app)
- Weather map: a **tree line** (trädgräns). When painting forest, the painter has *Trädgräns (m)* (default 3000 m, kept per user; 0 = none): forest isn't painted on ground higher than that, with any tool, and *Ta bort över gränsen* removes forest already above it (undoable).
- Fix: the page scripts (`app.js`, `fieldmap.js`, …) kept their old `?v=` numbers, so a browser with cached copies mixed old scripts with the new `cities.js` and cities / marshland couldn't be placed. All weather scripts now have a new number; **bump it whenever a weather script changes**.

## v1.21.2 (combined app)
- Weather map painter: forest and marshland are no longer painted on water. A pixel at or below the sea level of the height map keeps what it had, with every tool (brush, fill, polygon, …). Ice can still be painted on water (sea ice). Forest already painted on water stays until you paint it away.

## v1.21.1 (combined app)
- Standard map updated from an admin export: height map (1 217 changed pixels), forest and roads (53).

## v1.21.0 (combined app)
- Weather map: **cities.** Redigera → Städer places cities with a name, a population and a harbour switch. A city put close to a road sits on it and joins the roads through it; a road ended or started on a city snaps to it, and the travel calculator joins the roads at a city. **Sea voyages can only start from a harbour** (on maps that have any harbours; a map without keeps the old rule). Saved like the roads, in the admin export (`cities.json`) and releases (`citiesRelease`).
- Weather map: **marshland.** A painted layer like forest (Redigera → Sumpmark, layer Sumpmark). Marshland slows travel off the roads, and at 100 % nobody can cross it on foot: routes go round it (roads cross it, a river boat goes through it). In the export (`marsh.png`) and releases (`marshRelease`); events can ask for `marsh:`.
- Weather map: while painting the height map, **Branta vägar** shows the roads that are too steep for their kind on the heights as they are right now (with a count), so you can see what a change does to them.

## v1.20.0 (combined app)
- Weather travel: a fourth suggested route, **Säkrast** (safest). It keeps to roads, paths and nations and avoids
  open wilderness: off the roads a stretch counts 2 times its time, plus 0.01 per km from the nearest road or nation
  (at most 6 times), and more for forest; inside a nation's borders only 1.4 times. So from the open plains it goes
  south to the settled land, west along the roads and nations and north again rather than straight across.
  It is never allowed to take more than 3 times the time of Snabbast (otherwise the caution is eased off until it
  fits). All the numbers are in the travel settings (⚙, "Säkrast: …", `safe` in `travel.yaml`).

## v1.19.0 (combined app)
- Weather map: admins can set which regional map lies over which. In the "Kartbild" list on the standard map, each layer
  has ▲ ▼ buttons (a place further down lies over the ones above); the order is saved for everyone as
  `settings.layerOrder` of the standard map. Only the server's admins can do this (the server checks it, not just the page),
  and only on the standard map; maps that borrow its zoom images use the same order.
- The order is part of the admin export (under `settings` as `layerOrder`, bottom layer first), and
  `tools/apply-export.py` puts it into `map.json` with `layerOrderRelease`. A new release keeps an order set in the app
  unless the release carries a newer one (the same rule as for rivers and nations).

## v1.18.5 (combined app)
- New map layer "Damarien": the detailed map of Damarien (Jukon to Quilla, the Purpurhavet coast to Khazimbergen). It is
  placed from landmark towns and the coastline against the first Mundana map, and lies above the Jargien layer (which
  it partly overlaps in the north-west), so above "Asharien & Damarien" too. Off until chosen, like "Asharien & Damarien".
- The map is sharper than the full-size zoom level, so the zoom images get an extra, finer level (`-1`, marked
  `"extra": true` in `manifest.json`). The page draws it on top once you zoom in past the ordinary levels, and the 3D view
  ignores it. `tools/layer-from-image.py` got `--levels`, `--after` and `--default` for this.

## v1.18.4 (combined app)
- Mountain ranges updated from the admin export of 2026-11-12 23:52 (Mundana): the Drakkarbergen chain and one other
  range changed.

## v1.18.3 (combined app)
- The Colostro inset in the Jargien map layer is moved to where Colostro really is (12 map pixels east and 49.5 north:
  the town square, the mountains and the coast now line up with the first Mundana map). New
  `tools/move-layer-piece.py` moves one piece of a layer and rewrites only the zoom pieces it touches.

## v1.18.2 (combined app)
- The map layer "Egor–Nermada (Ivani, Ara)" is now called "Thalamur–Nermada". Its id is unchanged, so saved layer choices still work.

## v1.18.1 (combined app)
- The layer "Första Mundanakartan" is now the whole first Mundana map, made from the original picture (it was
  only the fragments left between the other regional maps, and was called "where it was blurry"). It lies under
  the other layers, so they still cover it where they overlap. New `tools/layer-from-image.py` makes or replaces a
  layer from one whole image.

## v1.18.0 (combined app)
- Weather map: the base map is now the plain world map (the whole known world, `default-map/map.jpg`, the
  3192 px picture with the added labels, stretched to the app's 5476 px size, which keeps every position, scale and
  the wrap width as they were). "Bara grundkartan" shows only that.
- The regional maps are drawn over it as layers only. The pre-merged zoom images and the old base's own zoom images
  are gone (`manifest.json` now has `"flat": true`); the default layers are the ones marked default, as before.
- Regional maps that were pasted straight into the old base and never were layers (e.g. Menon Aun, Mio–Enara) are
  not in the picture any more; they come back as layers later.

## v1.17.2 (combined app)
- Fixed: after removing the last sound change with a tag you had selected as a filter, the sound changes list stayed
  empty and the filter could not be cleared. The filter now clears itself.

## v1.17.1 (combined app)
- The word popup has a Type section: the word's type and where it comes from (set on the word, made by a derivation
  from another word, a cross-reference keeping its own type, or a different type in a particular meaning).

## v1.17.0 (combined app)
No visible changes.
- Spring Boot 3.5.16 → 4.1.2 (Spring Framework 7, Jackson 3), the line that gets free security fixes. The JSON the app
  reads and writes is kept as before (timestamps as `...+00:00`); the database engine (H2 2.3.232) is unchanged.
- Checked beyond the tests: the same 40 requests against the old and the new build give the same answers; the new
  build opens a database written by the old one (login, undo, redo); an export from the old build imports into the new.

## v1.16.2 (combined app)
No visible changes; housekeeping.
- Root and Rune's page script is split into nine files by area (`static/rune/js/`), loaded in order.
- Deleting a world or language, saving the ending order, the grammar import and rebuilding forms now happen
  completely or not at all (one transaction each).
- Release notes moved from the README to this file.
- Spring Boot 3.3.5 → 3.5.16 (the last free 3.x release).

## v1.16.1 (combined app)
- **Texts open much faster**: the dictionary and sound changes are loaded once per text instead of once per line and
  year, and each word is run through the sound changes once.
- **Runaway patterns are stopped**: a sound-change pattern or form-rule condition that tries endless combinations
  (a repeat inside a repeat) now gives an error on the word after a fraction of a second instead of tying the server up.
- **Protective headers** on every answer: other sites can't show the app in a frame, browsers don't guess file types,
  and over HTTPS browsers are told to stay on HTTPS.

## v1.16.0 (combined app)
- **Derivations**: a form rule with the switch **Makes a new word of another type** ticked gets a new type (e.g. *verb*) with a meaning pattern (*to {gloss}*).
  It isn't stored as a form. In a sentence, `(seal-verb-past)` or, with the verb maker written as its own part,
  `(verbmaker)(seal-past)` builds the noun into a verb first and then takes the **verb** endings. Derivations always
  go on first, whatever order they are written in, and more than one can follow each other.
- **Save as a word** (on demand): the sentence result and the word window's **All forms → Derived words** offer to
  add the derived word to the dictionary (*to seal*, verb, linked to *seal*, from the year the derivation is in
  use). From then on sentences use that word, with its own irregular forms, meanings and losses; `(to seal-past)`
  works too.

## v1.15.0 (combined app)
- **Texts**: an open text has its own **Edit** button, and the edit form scrolls into view.
- **Inherited texts**: tick **Branches inherit it** on a text and every branch of its language lists it too
  (marked *from Proto*). Opened in a branch, it is built with the branch's own words and sound changes, so the same
  story can be read side by side in each daughter language. It is edited in the language it belongs to.
- **Word types follow use**: a reference word keeps its own type (seal, a noun, pointing to holy, an adjective, gets
  the noun endings on holy's form), and a meaning change can give the word a type for that meaning (holy *also means*
  seal, as a noun). Sentences that reach the word through that meaning use that type's endings.
- **Several words, one meaning**: the sentence builder now picks the one that can take the endings asked for, and says
  which (by number and type); `seal-plural#12` keeps its endings.
- **Moving texts**: the edit form has **Move to another language…** (any language of the world you can edit).

## v1.14.0 (combined app)
- **Stacked endings**: in a sentence, `(elf-plural-definite)` puts several endings on one word, one from each group of
  the Word forms tab, in the group order set at the top of that tab (first = closest to the word), whatever order they
  are written in. Each ending is chosen by its rules as usual (word type, condition on the word as it is so far, year);
  linked endings sound as they did when the combined form comes into use (when its last ending does), and the result
  then goes through the later sound changes like any form. A stored form for the first ending (an irregular plural)
  is used as the base, and a form stored under a full name (e.g. *definite plural*) still wins. Two endings from one
  group, or one that isn't in use yet, are reported. Nothing is stored, so there's no need to list every combination.
- The word window has **All forms**: every combination of endings a word can take, built at a chosen year, with ▶.
- When a form name is shortened and matches a longer one (e.g. *definite* finding *definite plural*), the sentence
  builder now says so instead of using it silently.

## v1.13.0 (combined app)
- **Pronunciation by sound**: a small ▶ next to forms (dictionary, word window and its history per year, sentences,
  texts, etymology) reads them aloud. The spelling goes through the language's pronunciation map to IPA (no map: the
  form is read as IPA), then [eSpeak NG](https://github.com/espeak-ng/espeak-ng) says it, right in the browser; nothing
  is sent anywhere. Settings has **Voice** (the accent: Finnish, Quenya, Sindarin, Latin, English, German and more),
  **Stress** (first syllable, last syllable, or only where the IPA has ˈ) and **Speed**, plus a box to try things out
  that shows the IPA and what eSpeak was given. Branches use their parent's settings and map unless they have their
  own. Sounds a voice lacks are replaced by the nearest one it has; ones with no match are named.
- The speech engine (about 9 MB compressed) loads the first time you press ▶ and is cached after that. eSpeak NG is
  GPL-3.0 licensed; its licence is in `static/rune/speech/`, and its source is at the link above.

## v1.12.0 (combined app)
- **Texts** tab: keep longer texts (a story, a prayer, a list of proverbs) as lines written like sentences, one per line
  with the translation after a |, and give them up to six years. Opening a text builds every line at each year side by
  side, so you can watch the language change; missing words are marked per year. You can also show it at other years
  without saving them. Editors write texts; everyone who can read the language can read them. Part of Export everything.
- **Etymology** tab: pick a meaning and see the word for it in every language of the world as a family tree: its form
  today, and whether it is the language's own, inherited (from where and as what), borrowed (from where) or lost. Click
  a form to open the word. The word window has the same thing in short under **In other languages**.
- **Check** tab: likely mistakes and loose ends in one list: word problems, words that sound the same today, sound
  changes that change nothing (a typo in a pattern, a change too early or late), sounds in words that aren't on the
  Sounds tab, saved sentences with gaps, open missing words, family-tree problems and changes waiting for approval.
- **Notifications**: a bell on the start page and in Root and Rune. You hear when someone suggests a change to your
  language, when an editor changes it directly, when your suggestion is approved or turned down, and when a world or
  language is shared with you. Several changes by the same person in a day become one line. Clicking one opens the
  language on the right tab.
- The Claude connector can read the Check tab, etymologies and texts too.

## v1.11.0 (combined app)
- **Public languages**: an admin ticks **Public** at the top of a language. Anyone can then read it, also without
  logging in: dictionary, word histories, sound changes and versions, grammar, sounds, word forms, sentences (and
  building them), missing words, graphs and the Excel export. Other people find it under **Community** at the bottom of
  the language list, by world; visitors who aren't logged in see only the Community list and a *Log in* button.
  Making it private again hides it from everyone it isn't shared with.
- **Public suggestions**: a public language has a second switch, **Anyone can suggest changes** (admins and the owner).
  Then anyone logged in can add and change words, meanings, word forms, lost words, sound changes, grammar rows,
  sounds and form rules, and every such change waits for the owner's approval on the Changes tab. Things editors do
  directly (missing words list, sentences, versions, undo, imports) stay with the owner and editors.
- Endpoint: `POST /rune/api/languages/{id}/publish` `{public, suggestions}`.

## v1.10.1 (combined app)
- **Graphs start when the languages exist**: a language begins at its split year (a root language at its earliest word),
  and the divergence between two languages is only drawn from when both exist. Before, a branch counted as its parent
  before it split off, so pairs showed as identical for centuries before the branch existed, and the graph started 500
  years before the world's first split. Without a "from" year, the graph now starts when the first pair exists.

## v1.10.0 (combined app)
- **Suggest root** on the Missing words tab, for each missing meaning (and those the sentences need): shows root forms
  built like the Dictionary's *Suggest new roots* (they sound like the language and aren't close to any word), with a
  choice of syllables and *Other suggestions*. Click one to add it as the word for that meaning, with its type, built as
  "root", in the year given (remembered for the next one); the meaning is then ticked off.

## v1.9.0 (combined app)
- **Admin dashboard** at `/admin/` (admins only): every account with its role (site admin, weather admin from
  `EON_ADMINS`, user), when it joined and last logged in, and what it owns: worlds, languages and words in Root and
  Rune, campaigns, maps and notes in the weather generator, how many worlds or languages are shared with it, and its
  Claude connector addresses. Totals at the top; search and sort by any column. Linked from the start page (**Admin
  dashboard**) and from the **admin** badge there and in Root and Rune's top bar. Logins are recorded from this version on.

## v1.8.0 (combined app)
- **Import from Excel** (admins who own the language; on the Grammar and Bulk entry tabs): pick an .xlsx workbook, then
  **Import dictionary** (sheet "Ygg Elven dict": *dictionary*, *elven*, *build*, *year*, optionally *type*, *notes*, *group*)
  and/or **Import grammar and sounds** (sheet "Ygg Elven": grammar tables in columns A-G, consonant and vowel grids).
  The two importers existed already but had no button. Importing the dictionary again skips words that are there with
  the same meaning and form, so it doesn't add them twice; grammar asks before replacing what the language has.

## v1.7.0 (combined app)
- **Dictionaries are kept between page loads**: a worked-out dictionary is handed out again until anything in the data
  changes (in the test: 0.25–0.5 s → 30–70 ms for a repeat load). Any edit anywhere (a word, sound change, setting,
  tag switch, share, import…) makes the next load work it out afresh, so it's never out of date; the admin log and
  connector use don't count as changes. The 12 most recently used dictionaries are kept.

## v1.6.1 (combined app)
- **Faster dictionaries** (5–8× in a test with 6 languages, 240 sound changes, 2 300 words and 4 000 word forms:
  2.6 s → 0.5 s): each sound change's pattern is compiled once per request instead of for every word, form and branch;
  a branch gets its form at the split from the parent's run instead of running the parent's changes again; and a
  dictionary only evolves words into the languages it shows. The results are the same. Word histories, sentences and
  missing words use the same engine and get faster too.

## v1.6.0 (combined app)
- **Lost words**: in a word's window, **Mark as lost** in a language from a year (with an optional note). From that
  year the word is no longer used there: it shows greyed out with *lost 800* in the dictionary, sentences built for
  later years can't use it, and it shows up in Missing words again. Branches that split off after that year never get
  it (it isn't in their dictionary); branches that split off earlier keep it, unless it's marked lost there too.
  Goes through approval and undo like other edits; part of Export / Import everything.
- **Sentences at a given time**: the year field is now labelled *built as spoken in year*: each word is used as it was
  then (its form after the sound changes up to then, its meaning then). A word that can't be used says why:
  *'water' was lost in Proto in 800*, *'sky' isn't coined until 900*, or that it was coined after the split.

## v1.5.1 (combined app)
- Importing sound changes (JSON) can **tag everything in the file**: fill in *tag all imported* next to the file (one tag
  or several, comma separated). New sound changes get it, changed ones get it with their changes, and ones already in
  the app get it too (the check lists them as "changes tags"); their own tags are kept.

## v1.5.0 (combined app)
- **Tags on sound changes**: give a sound change tags (comma separated, e.g. `vowel shift, experimental`). The Sound changes
  tab shows every tag in view with its count; click one to see only those sound changes. The language's owner can
  **switch a tag off**: its sound changes are then left out wherever words evolve (dictionary, histories, sentences,
  missing words) in that language and all its branches, and shown greyed out, until it's switched on again.
- **Versions of sound changes**: *Versions* on the Sound changes tab saves a language's own sound changes (and its
  switched-off tags) under a name and note. **Compare** shows what has been added, removed and changed since, field by
  field; **Restore** (owner) puts them back as they were, after saving the current ones as a version, so a restore can
  be undone. Restoring clears the undo steps for sound changes in that language. Versions are part of Export / Import
  everything, and the Claude connector can list and compare them.
- Endpoints: `GET/POST /rune/api/languages/{id}/rule-versions`, `GET /rune/api/rule-versions/{vid}/compare`,
  `POST /rune/api/rule-versions/{vid}/restore`, `DELETE /rune/api/rule-versions/{vid}`, `POST /rune/api/languages/{id}/tag-switch`.

## v1.4.0 (combined app)
- **Claude connector**: read-only access for Claude (claude.ai) to Root and Rune and the weather generator, as one
  account, through an MCP server at `/mcp/<key>`. Admins make and revoke the addresses on the new **Claude connector**
  page. See *Claude connector* above.

## v1.3.0 (combined app)
- **Compound** tab: the language's missing words (and the meanings saved sentences need) are listed on the right, with a
  filter. Click one to coin the compound for it: its meaning and type are filled in, and **Use as word** saves the eroded
  form under that meaning, which takes it off the list. New *type* field for the compound.
- **Missing words** tab: a **Compound** button next to *Coin word* opens the Compound tab with that meaning picked.

## v1.2.0 (combined app)
- **Missing words** tab (next to Dictionary): mark meanings a language has no word for yet, one at a time or several at once
  (`meaning; type; note` per line). **Coin word** opens the dictionary with the meaning filled in; an entry is ticked off once the
  language has a word for it, its own or inherited (found the same way the sentence builder finds words), and
  **Remove the … that have a word now** clears those. Below the list: the meanings the saved sentences use but can't find,
  including words a branch lacks because they were coined in the parent after the split. Viewers see the list; owners and
  editors change it directly (it's a planning note, so no approval). Included in Export / Import everything.
- Endpoints: `GET/POST /rune/api/languages/{id}/missing`, `POST …/missing/bulk`, `POST …/missing/clear-filled`, `DELETE /rune/api/missing/{id}`.

## v0.24.3
- **Export everything** (admins, in the top bar): downloads all of Root and Rune as one JSON file: accounts (with their password hashes, so passwords keep working), worlds, languages, words, word forms, overrides, meanings, sound changes, form rules, grammar, sounds, sentences, sharing, pending changes and undo history, every row with its id. The admin log and reset codes are left out. Endpoint: `GET /api/admin/export-all` in the separate app, `GET /rune/api/admin/export-all` here.
- Made for moving to this combined app, where an admin reads the file with **Import everything** (see *Moving from the separate Root and Rune app* above).

## v0.24.2

- Borrow: the word list is searchable by meaning and by form at the same time (each entry reads "meaning · form"), so you no longer have to look a word up in the other language first.

## v0.24.1

- Suggest new roots: a language with a syllable shape but fewer than 5 words (or none that fit) now gets forms written straight from the shape and the sounds in its Sounds tab. The message also says what is actually missing (words, or sounds).

## v0.24.0

- **Syllable shape** (Grammar tab, owners edit it): write the shape of a syllable with C, V and brackets for optional parts, e.g. `C(C)V(C)` or `(V)C(C)V(C)` (a leading `(V)` is an optional vowel at the start of a word only). sh, ch, gh, ng and diphthongs count as one sound. "Suggest new roots" now only proposes forms of that shape and learns from the existing words that fit it (if at least 5 do). A language without its own shape uses its parent's.
- Long vowels (ā, ī, ū, ō) and ǫ, ą now count as vowels when counting syllables for root suggestions; `gh` is a built-in digraph in the sound table builder.

## v0.23.0

- **Build the sound table from the word list** (Sounds tab, "Build from the word list"): reads the forms of every word at the language's split year, at each year one of its own sound changes starts, and at the chosen end year (default 900), and sorts the letters into the consonant and vowel tables. A slider walks from the split to the end year; sounds that appear (underlined) or disappear are listed with the sound changes that start that year, and hovering a sound shows its IPA, how many words use it and examples. Digraphs (sh, ch, th, ng) and diphthongs (ai, ou ...) count as one sound; long vowels (ā, á, â, a:) and umlauts are recognised. Letters you have already placed in the table keep their row and column.
- "Save as the sound table" stores each sound with its from / until years, so the normal table's year box shows the same history. A later build replaces the earlier auto-built entries (their notes start with "auto-built"); sounds you added by hand are never touched.
- New endpoints: `GET /rune/api/languages/{id}/auto-sounds?to=900`, `POST /rune/api/languages/{id}/auto-sounds/apply`.

## v0.22.0

- **Suggest new roots** (Words tab): learns which letters follow which from the words the language already has (including inherited ones) and writes new forms in the same style. Choose how many and how many syllables; forms that already exist, or are very close to an existing word, are never suggested. Click a suggestion to put it in the form field.

## v0.21.1

- Fixed: importing sound changes whose `language` names a language that doesn't exist in the world crashed with a NullPointerException. It now reports "unknown language 'X'" for that entry.

## v0.21.0

- **Sound importer** (Sounds tab): paste a table (`Symbol | Kind | Row | Column | Notes | From | Until`, separated by tabs, `|` or `;`) or choose a JSON file with a `sounds` list. "Check" shows what would be added or changed; sounds with the same symbol, kind and years are updated. Goes through the normal approval and undo.
- **Borrowing a word** (Words tab): tick *borrow*, pick the language the word comes from, pick the word, and give the year. The word enters the borrowing language with the form the source word had in the source language in that year; the borrowing language's own sound changes then apply. The link is shown as "borrowed from ...". The borrowed form is copied once and does not change if the source language's rules change later.
- **Bulk entry**: new option *skip words that already exist here*; "home" matches a word glossed "home, world".
- New Human words (`human-vocab-extra.txt`): west, home, raider, east, south, north, farm (garðr), kingdom (ríki).

## v0.20.0
- Dictionary: a line above the table shows which languages this one inherits words from and how many words each contributes ("Inherits words from Drow (12) ← High (80) ← Elven (540)"). If the language tree stops words from reaching it, a warning says which language is the problem: a language with no split year, or one that splits earlier than the language it splits from. A word only passes down through every language between its own and the branch if each split year is the same as or later than the one above it.

## v0.19.0
- Dictionary: a filter box under each of ID, Gloss, Type, Build, Year and Form (all combine). ID accepts several ids separated by commas or spaces; Year accepts a number, a range `-8000..-5000`, or `<-5000` / `>0`. "Clear filters" resets them and the general search.

## v0.18.3
- Dictionary search also finds reference words: search "see", "reference", or the name of the word they point to.

## v0.18.2
- A form that starts earlier than its word is no longer reported as a problem: the word simply uses the form as it has evolved by the word's own year.

## v0.18.1
- Sound changes: the "show rules for" dropdown is now three visible buttons (only this language / this language + all branches / full path) with a rule count, and the choice is remembered.

## v0.18.0
- Graphs tab: "Mergers" check. For the language and each branch: how many words had different forms at the split but are identical now, which sound changes merge the most forms, and the biggest groups of words that now sound the same. Locked overrides are not counted in the per-rule numbers.

## v0.17.0
- Sound changes: export as JSON and import it again. A rule with its id is adjusted, a rule without an id (or an unknown one) is added, `"delete": true` removes one; "remove rules that are missing from the file" removes the rest in the languages the file covers. The file is checked first (bad regexes, unknown languages, missing rights) and nothing is changed until you press Apply. Goes through the normal edit pipeline (approval and undo).

## v0.16.0
- Dictionary: "Show only words with problems" button (with a count). A word has a problem when: no year is set (0), the form is empty, a sound change fails on it, or it refers to a word that doesn't exist. Problems are listed in red under the gloss.

## v0.15.1
- References to words coined after a branch split off now resolve (shown with the ancestor's form) instead of "refers to a word that was not found".
- A red banner appears when the page and the running server have different versions (stale backend). Keep `UI_VERSION` in app.js equal to the pom version.

## v0.15.0
- References are now explicit: tick "reference to another word" when adding or editing a word and pick the word it stands for. The word then shows the forms (definite, plural …) of that word, in the dictionary, popup and sentences, and has no forms of its own. Stored as `see #id`, so it survives renaming the target. Old words written as `see "word"` keep working; edit and tick the box to convert them.
- Only `see …` and `=…` count as notes now; other text containing quotes or `#` is sound-changed as normal.
- Rebuild with removal also clears leftover forms of reference words.

## v0.14.0
- Rebuild group / Rebuild all (per form) now also offers to remove existing forms that no longer fit any rule of their type (wrong word type, condition no longer matches). A list is shown first; forms whose type has no rule at all are never touched.

## v0.13.0
- Graphs tab: divergence between languages over time (average edit distance, or share of identical words).
- Word popup: evolution tree (branches at each split, rule on each step).
- Cross-references: a word whose form is `see "wind"` (or `see #12`) now uses the forms of the word it points to, in the dictionary, the sentence builder and the word popup.

## v0.12.0
- Word forms: "Rebuild group" per group; year defaults (form rule linked to a dictionary word starts at that word's year; new forms in the word popup start at the word's year) with a warning if set older than the word.
- Excel export: new sheets Check (latest form of the word and of every form type in every branch), Form rules (with group), Meanings, Sentences.

## v0.10.0
- **Sentences tab**: write `(to see)(you-obj) (poss)(darkness)(pos-in) (me)`; each part is a dictionary meaning (`meaning-label` picks a word form, `meaning#12` picks by id, `=text` stays as written). Forms are taken as they are in the selected language at the given year (sound changes, locked overrides and branch splits included); missing words or forms are flagged as gaps. Sentences can be saved.
- **Change meaning** button in the word popup: from a year, a word in a language (and branches splitting off later) also means / changes to another meaning. Shown under the gloss in the dictionary; the sentence builder finds words by their current meanings. Goes through the normal edit/approval/undo pipeline.

## v0.9.0
- A branch language's dictionary now also lists the parent words that existed when it split off, shown in the branch's own evolved form (tinted rows, "from <language>" badge, "Open in <language>" button). Words coined after the split are not shown. Toggle with "Show inherited words".
- Cross-references: a form that starts with `see `, starts with `=`, or contains `"` or `#` (e.g. `see "teot"`, `see #12`) is treated as a note and is never sound-changed.
