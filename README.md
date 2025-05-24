# RRWGuildBot

## local setup
cd public_bot && npm install
node public_bot/index.js

**bot invite link:**

https://discord.com/oauth2/authorize?client_id=1373785979671810199&scope=bot%20applications.commands&permissions=277293894656

permissions requested:

General: Manage Roles, View Channels

Text: Send Messages, Send Messages in Threads, Read Message History, Use Slash Commands


# Bot Documentation 

## Commands
### admin commands:
```/admin-guildbot ping-add <forum-channel> <notification-channel> <role>>
Configure which forum channel, notification channel, and role should be used for helper notifications.
Admin only.

/admin-guildbot ping-delete <forum-channel>
Removes all ping mappings for a specific forum channel.
Admin only.

/admin-guildbot user-story-add <username> <story-url>
Maps a Discord user to a story, allowing multiple stories per user, tracked per server.
Admin only.

/admin-guildbot user-story-delete <username>
Deletes all story mappings for a specific user, for this server.
Admin only.

/admin-guildbot announcement-channel <channel>
Set the channel where RS milestone announcements are posted.
Admin only.
```
### user commands:
```
/guildbot helpers
Use in a forum thread to pinging helpers in the notification channel.

/guildbot stories <username (OPTIONAL)>
Displays the current RR stats for all the stories mapped to a user.
```

## Ranks

when reaching the set threshold, users are gifted the role of "Ranked" and the specific rank role.
They are also pinged with a congrats in the Ranks channel

**B-Rank**
Reached Rising Stars genre specific, or Gained 500 followers

**A rank**
Reached Rising Stars main page, or Gained 1,000 followers

**S Rank**
Reached top 10 Rising Stars, or Gained 2,000 followers