import Bottleneck from "bottleneck";
import fs from "fs";

const limiter = new Bottleneck({ minTime: 800 });

async function wrappedFetch(
  input, // URL | RequestInfo
  init, // RequestInit | undefined,
) {
  let response; //: Response | undefined;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error('***You may not be connected to the internet***');
  }
  if (!response.ok) {
    if (
      response.status === 500 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
    ) {
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          const retryResponse = await fetch(input, init);
          if (!retryResponse.ok) {
            reject(
              new Error(
                `${retryResponse.status} - ${retryResponse.statusText}`,
              ),
            );
          } else {
            resolve(retryResponse);
          }
        }, 1000);
      });
    }
    let keyErr = '';
    if (response.status === 400) {
      keyErr = ' ***start.gg API key invalid!***';
    } else if (response.status === 401) {
      keyErr = ' ***start.gg API key expired!***';
    }
    throw new Error(`${response.status} - ${response.statusText}.${keyErr}`);
  }

  return response;
}
  
async function fetchGql(
  query, //: string,
  variables //: any
) {
  const response = await wrappedFetch('https://api.start.gg/gql/alpha', {
    method: 'POST',
    headers: {
      Authorization: `Bearer YOUR API KEY HERE`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }

  return json.data;
}

const TOURNAMENT_QUERY = `
  query TournamentQuery($slug: String) {
    tournament(slug: $slug) {
      name
      participants(query: {}) {
        pageInfo {
          total
        }
      }
    }
  }
`;
const DISCRIMINATORS_QUERY = `
  query DiscriminatorsQuery($slug: String) {
    tournament(slug: $slug) {
      participants(query: {perPage: 499}) {
        nodes {
          gamerTag
          user {
            discriminator
          }
        }
      }
      events {
        standings(query: {perPage: 1}) {
          nodes {
            player {
              user {
                discriminator
              }
            }
            placement
          }
        }
      }
    }
  }
`
async function addDiscriminatorsForSlug(
  discrimToCount, // map,
  discrimToTag, // map,
  winnerDiscrims, // set,
  slug, // string,
) {
  const data = await limiter.schedule(() => fetchGql(DISCRIMINATORS_QUERY, { slug }));
  data.tournament.participants.nodes
    .filter((node) => node.user?.discriminator && node.gamerTag)
    .forEach((node) => {
      const { discriminator } = node.user;
      discrimToCount.set(discriminator, (discrimToCount.get(discriminator) ?? 0) + 1);
      discrimToTag.set(discriminator, node.gamerTag);
    });
  data.tournament.events.forEach((event) => {
    const node = event.standings?.nodes[0];
    if (node) {
      const discriminator = node.player?.user?.discriminator
      if (node.placement === 1 && discriminator) {
        winnerDiscrims.add(discriminator);
        console.log(`${slug}: ${discriminator}`);
      }
    }
  })
}

async function writeDiscriminatorsJson() {
  const discrimToCount = new Map();
  const discrimToTag = new Map();
  const winnerDiscrims = new Set();
  await addDiscriminatorsForSlug(discrimToCount, discrimToTag, winnerDiscrims, "only-noobs");
  for (let n = 2; n < 200; n++) {
    let slug = `only-noobs-${n}`;
    if (n === 4) {
      slug = 'onlynoobs-4';
    } else if (n === 11) {
      slug = 'onlynoobs-11';
    } else if (n === 34) {
      slug = 'onlynoobs-34-1';
    } else if (n === 49) {
      slug = 'onlynoobs-49';
    } else if (n === 102) {
      slug = 'only-noobs-102-1';
    } else if (n === 171) {
      slug = 'only-noobs-171-1';
    }
    await addDiscriminatorsForSlug(discrimToCount, discrimToTag, winnerDiscrims, slug);
  }
  fs.writeFileSync('discriminators.json', JSON.stringify(Array.from(discrimToCount)));
  fs.writeFileSync('winnerDiscriminators.json', JSON.stringify(Array.from(winnerDiscrims)));
  fs.writeFileSync(
    'entrants.csv',
    Array
      .from(discrimToTag.keys())
      .map((discrim) => `${discrimToTag.get(discrim)},${discrimToCount.get(discrim)}`)
      .join('\n'));
}
// writeDiscriminatorsJson();

async function getInvalids() {
  const invalidDiscriminators = new Set(JSON.parse(fs.readFileSync('winnerDiscriminators.json', {encoding: 'utf8'})));
  const validDiscriminators = new Map(JSON.parse(fs.readFileSync('discriminators.json', {encoding: 'utf8'})));
  const data = await fetchGql(DISCRIMINATORS_QUERY, { slug: 'only-noobs-200' });
  const validParticipants = [];
  const invalidParticipants = [];
  data.tournament.participants.nodes.forEach((node) => {
    const discriminator = node.user?.discriminator;
    if (discriminator) {
      if (!invalidDiscriminators.has(discriminator) && validDiscriminators.has(discriminator)) {
        validParticipants.push([node.gamerTag, validDiscriminators.get(discriminator)]);
      } else {
        invalidParticipants.push(node.gamerTag);
      }
    }
  });
  console.log(
    `valid (${validParticipants.length}):\n${validParticipants
      .sort((a, b) => {
        const freqDiff = b[1] - a[1];
        if (freqDiff) {
          return freqDiff;
        }
        return a[0].localeCompare(b[0]);
      })
      .join('\n')}`
  );
  console.log(`\ninvalid (${invalidParticipants.length}):\n${invalidParticipants.sort((a, b) => a.localeCompare(b)).join('\n')}`);
}
getInvalids();
