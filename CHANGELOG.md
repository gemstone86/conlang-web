# Changes

Newest first. Versions from 1.x on are the combined app (Root and Rune + Weather generator).

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
