export const adaptiveDeterminismFixture = `
  <svg viewBox="0 0 100 100">
    <style>.paint { fill: #123456; }</style>
    <defs>
      <path id="curve" class="paint" fill-rule="evenodd"
        d="M0 0C0 20 20 20 20 0L16 4C16 12 4 12 4 4Z"/>
    </defs>
    <g transform="translate(5 7) scale(3)">
      <use href="#curve"/>
    </g>
  </svg>
`;

export const adaptiveDeterminismChecksums = {
  document: "0b56d99f",
  trace: "bffdaec7",
};

export const diagnosticDeterminismFixture =
  '<svg><unsupported id="ä"/><unsupported id="z"/></svg>';

export const diagnosticDeterminismChecksum = "428059bc";
