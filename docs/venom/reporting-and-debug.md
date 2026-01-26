# reporting + debug

results
- default format: `xml` (xUnit)
- other formats: `json`, `yml`, `tap`
- set `--format` / `VENOM_FORMAT`
- set `--output-dir` / `VENOM_OUTPUT_DIR`
- `--html-report` writes HTML report in output dir

ci integration
- xUnit XML for Jenkins/JUnit viewers

logging
- `venom.log` generated each run
- `info` keyword in step prints info to output
- `-v` verbose
- `-vv` debug verbose + stats + dump file on error
- `-vvv` debug verbose + stats + dump + pprof results
