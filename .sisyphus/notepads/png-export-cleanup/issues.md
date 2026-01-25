# Issues - PNG Export Cleanup

## Problems & Gotchas
- 

## [2026-01-25] Issue: architecture-diagram.png Background Color

**Severity:** Medium  
**Status:** Documented (not fixed in this plan)

**Description:**
One PNG output has incorrect background color:
- File: `visual-grading_2026-01-25_06-53-19/architecture-diagram.png`
- Expected: White (#ffffff)
- Actual: Light blue/cyan

**Context:**
- Other PNGs from same test run have correct white background
- Issue appears isolated to this specific diagram
- Text also shows slight pixelation (may be related)

**Impact:**
- Violates quality requirement for white background
- May indicate rendering inconsistency

**Root Cause:**
Unknown - requires investigation. Possible causes:
- Diagram-specific rendering settings
- Test data configuration
- Excalidraw export API behavior with certain element combinations

**Recommendation:**
- Investigate test data for architecture-diagram test case
- Check if background color is specified in diagram JSON
- Verify Excalidraw exportToBlob appState.viewBackgroundColor setting
- Not blocking for this cleanup plan (pre-existing issue)

