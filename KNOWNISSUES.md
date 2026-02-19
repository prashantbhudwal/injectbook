# Known Issues

## YAML frontmatter safety for `SKILL.md`

- `SKILL.md` frontmatter currently writes `name` and `description` as plain scalars in the template.
- Book titles/descriptions can contain `:` and other YAML-significant characters.
- Some YAML/frontmatter parsers can misinterpret unquoted values, causing parse failures or incorrect metadata.

### Example

- Potentially unsafe:
  - `name: To Sell Is Human: The Surprising Truth About Moving Others Skill`
- Safer:
  - `name: "To Sell Is Human: The Surprising Truth About Moving Others Skill"`

### Follow-up (next agent cycle)

- Update `SKILL.md` generation to emit YAML-quoted scalars for `name` and `description` (and any other free-text fields in frontmatter).
- Add a regression test with colon-containing title/description to ensure frontmatter remains valid.

## Corpus conversion quality gaps (Homebrew `0.3.0`)

- End-to-end corpus conversion succeeds, but parser quality is inconsistent on some books.

### Oversized chapters still slip through

- Some converted books still produce very large chapter files (observed up to ~68k and ~105k words in corpus runs).
- This indicates current splitting heuristics are not reliably enforcing practical chapter sizes for all PDF-derived content.

### Backmatter/note-heavy chapters are still included

- Some outputs still include chapters that are mostly non-core content (for example acknowledgements, index, notes-style backmatter).
- Current boilerplate/note filtering needs stronger detection so core narrative chapters are prioritized by default.
