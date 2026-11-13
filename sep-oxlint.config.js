export default {
  categories: {
    correctness: "off", suspicious: "off", pedantic: "off", perf: "off",
    restriction: "off", style: "off", nursery: "off"
  },
  rules: {
    "unicorn/numeric-separators-style": ["error", {
      binary:       {groupLength: 4, minimumDigits: 0},
      hexadecimal:  {groupLength: 2, minimumDigits: 0},
      number:       {groupLength: 4, minimumDigits: 6},
      octal:        {groupLength: 4, minimumDigits: 0},
      onlyIfContainsSeparator: false
    }]
  }
};
