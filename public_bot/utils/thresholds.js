const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../../config_base.json');
let botConfig = {};
if (fs.existsSync(configPath)) {
  botConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Helper to get role/channel IDs for a guild
function getGuildIds(guildId) {
  const guildConfig = botConfig.guilds?.[guildId] || {};
  return {
    ranksRoleId: guildConfig.ranksRoleId,
    bRankRoleId: guildConfig.bRankRoleId,
    aRankRoleId: guildConfig.aRankRoleId,
    sRankRoleId: guildConfig.sRankRoleId,
    ranksChannelId: guildConfig.ranksChannelId,
  };
}

const THRESHOLDS = [
  { key: 'followers-500', statKey: 'followers', value: 500, message: (user, story, val, userName) => `🎉 ${userName}'s story **${story}** just passed ${val.toLocaleString()} followers!` },
  { key: 'followers-1000', statKey: 'followers', value: 1000, message: (user, story, val, userName) => `🎉 ${userName}'s story **${story}** just passed ${val.toLocaleString()} followers!` },
  { key: 'followers-2000', statKey: 'followers', value: 2000, message: (user, story, val, userName) => `🎉 ${userName}'s story **${story}** just passed ${val.toLocaleString()} followers!` },
  { key: 'totalViews-1000', statKey: 'totalViews', value: 1000, message: (user, story, val, userName) => `👀 ${userName}'s story **${story}** just passed ${val.toLocaleString()} total views!` },
  { key: 'totalViews-50000', statKey: 'totalViews', value: 50000, message: (user, story, val, userName) => `👀 ${userName}'s story **${story}** just passed ${val.toLocaleString()} total views!` },
  { key: 'totalViews-100000', statKey: 'totalViews', value: 100000, message: (user, story, val, userName) => `👀 ${userName}'s story **${story}** just passed ${val.toLocaleString()} views!` },
  { key: 'totalViews-500000', statKey: 'totalViews', value: 500000, message: (user, story, val, userName) => `👀 ${userName}'s story **${story}** just passed ${val.toLocaleString()} views!` },
  { key: 'totalViews-1000000', statKey: 'totalViews', value: 1000000, message: (user, story, val, userName) => `👀 ${userName}'s story **${story}** just passed ${val.toLocaleString()} views!` },
  { key: 'wordCount-50000', statKey: 'wordCount', value: 50000, message: (user, story, val, userName) => `${userName}'s story **${story}** just passed ${val.toLocaleString()} words!` },
  { key: 'wordCount-100000', statKey: 'wordCount', value: 100000, message: (user, story, val, userName) => `${userName}'s story **${story}** just passed ${val.toLocaleString()} words!` },
  { key: 'wordCount-500000', statKey: 'wordCount', value: 500000, message: (user, story, val, userName) => `${userName}'s story **${story}** just passed ${val.toLocaleString()} words!` },
  { key: 'wordCount-1000000', statKey: 'wordCount', value: 1000000, message: (user, story, val, userName) => `${userName}'s story **${story}** just passed ${val.toLocaleString()} words!` },

  // Reward thresholds (ranks)
  {
    key: 'b-rank',
    statKey: 'rewardThreshold',
    value: 1,
    rewardRank: 'B-Rank',
    message: (userName, story, _, stats, userId) => {
      let msg = `🎉 Congrats <@${userId}>! You have achieved **B-Rank** with your story **${story}**`;
      if (stats.followers >= 500) {
        msg += ' by reaching over 500 followers!';
      } else if (stats.rsGenre) {
        msg += ' by appearing on a Rising Stars genre list!';
      } else {
        msg += '!';
      }
      if (stats.rsGenreList && Array.isArray(stats.rsGenreList) && stats.rsGenreList.length > 0) {
        const genreStrings = stats.rsGenreList.map(
          g => `${g.genre}${g.position ? ` (#${g.position})` : ''}`
        );
        msg += `\nWe've detected your story at: ${genreStrings.join(', ')}`;
      }
      return msg;
    },
    check: (stats) => stats.followers >= 500 || stats.rsGenre,
    getRoleId: (guildId) => getGuildIds(guildId).bRankRoleId,
  },
  {
    key: 'a-rank',
    statKey: 'rewardThreshold',
    value: 2,
    rewardRank: 'A-Rank',
    message: (userName, story, _, stats, userId) => {
      let msg = `🎉 Congrats <@${userId}>! You have achieved **A-Rank** with your story **${story}**`;
      if (stats.followers >= 1000) {
        msg += ' by reaching over 1,000 followers!';
      } else if (stats.rsMain) {
        msg += ' by appearing on the Rising Stars main page!';
      } else {
        msg += '!';
      }
      return msg;
    },
    check: (stats) => stats.followers >= 1000 || stats.rsMain,
    getRoleId: (guildId) => getGuildIds(guildId).aRankRoleId,
  },
  {
    key: 's-rank',
    statKey: 'rewardThreshold',
    value: 3,
    rewardRank: 'S-Rank',
    message: (userName, story, _, stats, userId) => {
      let msg = `🎉 Congrats <@${userId}>! You have achieved the legendary **S-Rank** with your story **${story}**`;
      if (stats.followers >= 2000) {
        msg += ' by reaching over 2,000 followers!';
      } else if (stats.rsTop10) {
        msg += ' by reaching the Top 10 on Rising Stars main!';
      } else {
        msg += '!';
      }
      return msg;
    },
    check: (stats) => stats.followers >= 2000 || stats.rsTop10,
    getRoleId: (guildId) => getGuildIds(guildId).sRankRoleId,
  },
];

function checkThresholds(stats, prevStats, userId, storyName, userName) {
  const triggered = [];
  for (const t of THRESHOLDS) {
    const current = Number(stats[t.statKey] || 0);
    const previous = Number(prevStats?.[t.statKey] || 0);

    if (t.statKey === 'rsPosition') {
      if (
        current > 0 && current <= t.value &&
        (previous === 0 || previous > t.value)
      ) {
        triggered.push({ ...t, current, previous, messageText: t.message(userId, storyName, t.value, userName) });
      }
    } else {
      if (current >= t.value && previous < t.value) {
        // Pass stats as the fourth argument for reward thresholds
        const messageText = t.statKey === 'rewardThreshold'
          ? t.message(userName, storyName, t.value, stats)
          : t.message(userId, storyName, t.value, userName);
        triggered.push({ ...t, current, previous, messageText });
      }
    }
  }
  return triggered;
}

module.exports = { checkThresholds, THRESHOLDS, getGuildIds };