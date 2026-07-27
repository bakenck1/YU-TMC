const fontFace = (family) => `
  @font-face {
    font-family: '${family}';
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: local('Arial');
  }
`;

module.exports = {
  "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap":
    fontFace("Geist"),
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap":
    fontFace("Geist Mono"),
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&display=swap":
    fontFace("Montserrat"),
};
