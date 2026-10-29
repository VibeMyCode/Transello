// Public URLs. Empty = hidden in UI (no placeholder links, spec §10 "no mock/demo buttons").
const SITE = 'https://vibemycode.github.io/transello-site';
export const LINKS = {
  site: `${SITE}/`,
  // Store reviews page: "Rate" in Settings → About.
  rate: 'https://chromewebstore.google.com/detail/transello/pddhdkkkpeefggfeofeeekodjlnfdlgl/reviews',
  feedback: 'https://github.com/VibeMyCode/transello/issues/new/choose', // GitHub issue forms; no public e-mail
  privacy: `${SITE}/privacy.html`,
  repo: 'https://github.com/VibeMyCode/Transello',
  // The one file that talks to AI providers: the place to verify where text and keys go.
  cloudCode: 'https://github.com/VibeMyCode/Transello/blob/main/src/core/cloud.ts',
  privacyRu: `${SITE}/privacy-ru.html`,
  support: `${SITE}/support.html`, // voluntary donations (ERC-20 address)
};
