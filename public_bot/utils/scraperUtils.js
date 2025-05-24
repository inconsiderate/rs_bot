const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const cheerio = require('cheerio');


async function fetchAndUpsertStory(storyUrl, db) {
  const res = await fetch(storyUrl);
  if (!res.ok) throw new Error('Failed to fetch story page');
  const html = await res.text();
  const $ = cheerio.load(html);

  // Scrape tags
  const tags = [];
  $('.tags a.fiction-tag').each((i, el) => {
    tags.push($(el).text().trim());
  });

  const storyName = $('.fic-title h1').text().trim();
  const authorName = $('.fic-title h4 a').text().trim();
  let blurb = $('.fiction-info .description').text().trim();
  const trimmedBlurb = blurb.length > 130
    ? blurb.slice(0, 130).replace(/\s+?(\S+)?$/, '') + '...'
    : blurb;
  const authorProfileUrl = $('.fic-title h4 a').attr('href');
  const authorIdMatch = authorProfileUrl && authorProfileUrl.match(/\/profile\/(\d+)/);
  const authorId = authorIdMatch ? authorIdMatch[1] : null;

  // Extract story_id from the URL (e.g. https://www.royalroad.com/fiction/12345-title)
  const storyIdMatch = storyUrl.match(/\/fiction\/(\d+)/);
  const storyIdValue = storyIdMatch ? storyIdMatch[1] : null;

  // Scrape stats
  const stats = scrapeStats($);

  // Scrape cover image
  let coverImage = null;
  const coverImgEl = $('.cover-art-container').find('img');
  if (coverImgEl && coverImgEl.attr('src')) {
    coverImage = coverImgEl.attr('src');
  }

  // Check if story exists
  let [rows] = await db.query('SELECT id FROM story WHERE story_address = ?', [storyUrl]);
  let storyId;
  if (rows.length === 0) {
    // Insert
    const [insertResult] = await db.query(
      `INSERT INTO story (story_name, story_id, story_address, story_author_id, story_author, blurb, cover_image)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [storyName, storyIdValue, storyUrl, authorId, authorName, trimmedBlurb, coverImage]
    );
    storyId = insertResult.insertId;
  } else {
    // Update
    storyId = rows[0].id;
    await db.query(
      `UPDATE story SET story_name=?, story_id=?, story_author_id=?, story_author=?, blurb=?, cover_image=?
       WHERE id=?`,
      [storyName, storyIdValue, authorId, authorName, trimmedBlurb, coverImage, storyId]
    );
  }

  // Always update latest stats
  await db.query(
    `UPDATE story SET
      latest_followers = ?,
      latest_ratings = ?,
      latest_favourites = ?,
      latest_views = ?,
      latest_words = ?
     WHERE id = ?`,
    [
      stats.followers ?? null,
      stats.ratings ?? null,
      stats.favourites ?? null,
      stats.totalViews ?? null,
      stats.wordCount ?? null,
      storyId
    ]
  );

  return {
    storyId,
    storyName,
    authorId,
    authorName,
    trimmedBlurb,
    tags,
    stats,
    coverImage
  };
}

function buildFullDataEmbed(row, stats, tags) {
  const fields = [
    {
      name: 'Followers',
      value: `${stats.followers ?? row.start_follower_count ?? 'N/A'}`,
      inline: true
    },
    {
      name: 'Favorites',
      value: `${stats.favourites ?? 'N/A'}`,
      inline: true
    },
    {
      name: 'Ratings',
      value: `${stats.ratings ?? 'N/A'}`,
      inline: true
    },
    {
      name: 'Total Views',
      value: `${stats.totalViews ?? row.start_view_count ?? 'N/A'}`,
      inline: true
    },
    {
      name: 'Word Count',
      value: `${stats.wordCount ?? 'N/A'}`,
      inline: true
    }
  ];

  // If odd number of fields, add a blank field for balance
  if (fields.length % 3 === 2) {
    fields.push({ name: '\u200B', value: '\u200B', inline: true });
  }

  // Trim the blurb/description to 400 characters and add "..." if needed
  let description = stats.description ?? row.blurb ?? '*No blurb available.*';
  if (description.length > 400) {
    description = description.slice(0, 400).replace(/\s+?(\S+)?$/, '') + '...';
  }

  return {
    title: row.story_name,
    url: row.story_address,
    description,
    thumbnail: { url: row.cover_image },
    fields,
    footer: {
      text: tags.length ? `${tags.join(', ')}` : 'Tags: Unknown'
    }
  };
}

// Notification-style embed (short, for threshold pings, etc)
function buildNotificationEmbed(row, stats, tags, notificationText) {
  let description = notificationText;
  if (row.blurb) {
    let trimmedBlurb = row.blurb.length > 200
      ? row.blurb.slice(0, 200).replace(/\s+?(\S+)?$/, '') + '...'
      : row.blurb;
    description += `\n\n${trimmedBlurb}`;
  }
  return {
    title: row.story_name,
    url: row.story_address,
    description,
    thumbnail: { url: row.cover_image }
  };
}

// Story list embed (for /guildbot stories)
function buildStoryListEmbed(row, stats) {
    const fields = [
        {
        name: 'Followers',
        value: `${stats.followers ?? row.start_follower_count ?? 'N/A'}`,
        inline: true
        },
        {
        name: 'Total Views',
        value: `${stats.totalViews ?? row.start_view_count ?? 'N/A'}`,
        inline: true
        }
    ]
  return {
    title: row.story_name,
    url: row.story_address,
    thumbnail: { url: row.cover_image },
    fields,
  };
}

function scrapeStats($) {
  const stats = {};
  const wanted = ['Followers', 'Favorites', 'Ratings', 'Total Views', 'Pages'];
  const items = $('.fiction-info li').toArray();
  for (let i = 0; i < items.length; i++) {
    const text = $(items[i]).text().trim();
    for (const label of wanted) {
      if (text.startsWith(label) && text.endsWith(':')) {
        const valueLi = items[i + 1];
        if (valueLi) {
          const value = $(valueLi).text().replace(/,/g, '').trim();
          // Normalize keys to match embed expectations
          switch (label) {
            case 'Followers':
              stats.followers = value;
              break;
            case 'Favorites':
              stats.favourites = value;
              break;
            case 'Ratings':
              stats.ratings = value;
              break;
            case 'Total Views':
              stats.totalViews = value;
              break;
            case 'Pages':
              stats.pages = value;
              stats['Latest Page Count'] = value;
              break;
          }
        }
      }
    }
  }
  // Word count
  const wordCountMatch = $('.fiction-info li i[data-content]').attr('data-content')?.match(/from ([\d,]+) words/);
  stats.wordCount = wordCountMatch ? wordCountMatch[1].replace(/,/g, '') : null;

  // Cover image
  const coverImg = $('.cover-art-container img').attr('src');
  stats.coverImage = coverImg || null;

  // Description from .description class
  const description = $('.description').first().text().trim();
  stats.description = description || null;

  return stats;
}

module.exports = {
  fetchAndUpsertStory,
  buildFullDataEmbed,
  buildNotificationEmbed,
  buildStoryListEmbed,
  scrapeStats,
};