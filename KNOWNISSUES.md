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
