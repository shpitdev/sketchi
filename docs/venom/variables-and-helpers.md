# vars + helpers

vars definition
- testsuite `vars:` map
- override/add via `--var key=value` (repeatable)
- load vars file via `--var-from-file vars.yml` (YAML dictionary)
- env fallback: `VENOM_VAR_key=value`

built-in vars
- `{{.LocalIP}}`
- `{{.Timestamp}}`
- `{{.Time}}`
- `{{.Date}}`
- `{{.DateRFC3339}}`
- `{{.DateRFC3339Nano}}`
- `{{.DateRFC1123}}`

secrets
- testsuite `secrets:` list
- values masked in console, `venom.log`, dump files

helpers (templating)
- abbrev, abbrevboth, camelcase, capitalize, cat, default, dict, digest, duration
- env, expandenv, expanduser, first, fromJson, has, hasPrefix, hasSuffix
- htmlDate, htmlDateInZone, htmlescape, indent, initials, int, join, kebabcase
- last, lower, max, merge, min, nindent, nospace, now, omit, plural, pluck
- quote, regexFind, regexFindAll, regexMatch, regexReplaceAll, regexReplaceAllLiteral
- replace, replaceAll, replaceAllLiteral, round, semver, sha1sum, sha256sum, shuffle
- snakecase, sortAlpha, split, splitList, substr, swapcase, ternary, title, toDate
- toDecimal, toJson, trim, trimAll, trimPrefix, trimSuffix, trimall, trunc, tuple
- unset, upper, urlJoin, urlParse, urlquery, uuidv4, values, without, wrap, wrapWith
