const interCss = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(/System/Library/Fonts/SFNS.ttf) format('truetype');
}
`;

module.exports = {
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap': interCss,
  'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap': interCss,
};
