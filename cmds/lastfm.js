exports.data = {
	name: 'LastFM Query',
	command: 'lastfm',
	description: 'LastFM functions',
	group: 'fun',
	syntax: 'lastfm [function] [optional:username]',
	author: 'Matt C: matt@artemisbot.uk',
	permissions: 0,
	anywhere: true
};

const request = require('request-promise-native');
const Discord = require('discord.js');
const moment = require('moment');
const log = require('../lib/log.js')(exports.data.name);
const LastFMDB = require('../lib/models/lastfm');
const config = require('../config.json');

const safeLink = link => {
	return link.replace('(', '%28').replace(')', '%29');
};

exports.func = async (msg, args) => {
	try {
		msg.channel.startTyping();
		if (args.length === 0) {
			msg.channel.stopTyping(true);
			return msg.reply(`You must provide a function to this command. View available functions with \`lastfm help\`.`);
		}
		await LastFMDB.sync();
		const userData = await LastFMDB.findOne({
			where: {
				userId: msg.author.id
			}
		});
		const r = request.defaults({
			baseUrl: `http://ws.audioscrobbler.com/2.0/?api_key=${config.lfmKey}&format=json&`,
			json: true
		});
		log.verbose(`${msg.member.displayName} (${msg.author.username}#${msg.author.discriminator}) has looked up ${args[0]} on last.fm for user ${args[1] || userData.lfmUsername} in #${msg.channel.name} on ${msg.guild.name}.`);
		switch (args[0].toLowerCase()) {
			case 'nowplaying': {
				if (!args[1] && !userData) {
					msg.channel.stopTyping(true);
					return msg.reply('You must either have a linked last.fm account or provide a username in your command.');
				}
				const user = args[1] || userData.lfmUsername;
				log.debug('Found user.');
				if ((await r(`&method=user.getinfo&user=${user}`)).message === 'User not found') {
					msg.channel.stopTyping(true);
					return msg.reply('Specified user does not exist.');
				}
				const songData = (await r(`&method=user.getRecentTracks&user=${user}`)).recenttracks.track[0];
				if (!songData) {
					return msg.reply(`${user} has never scrobbled anything.`);
				}
				log.debug('Fetched nowplaying data.');
				const embed = new Discord.RichEmbed({
					color: 0xD51007,
					fields: [
						{
							name: 'Song',
							value: `[${songData.name}](${safeLink(songData.url)})` || 'None',
							inline: true
						},
						{
							name: 'Album',
							value: songData.album['#text'] || 'None',
							inline: true
						},
						{
							name: 'Artist',
							value: songData.artist['#text'] || 'None',
							inline: true
						}
					],
					thumbnail: {
						url: songData.image[1]['#text']
					},
					footer: {
						text: `Powered by the last.fm API. Took ${moment().diff(msg.createdAt)} ms.`
					}
				});
				try {
					if (songData['@attr'].nowplaying) {
						embed.setAuthor(`Now playing on last.fm for ${user}`, 'https://cdn.artemisbot.uk/img/lastfm.png', `https://last.fm/user/${user}`);
					}
				} catch (err) {
					embed.setAuthor(`Last played on last.fm for ${user}`, 'https://cdn.artemisbot.uk/img/lastfm.png', `https://last.fm/user/${user}`);
				}
				log.debug('Created embed data.');
				msg.channel.stopTyping(true);
				await msg.channel.send('', embed);
				log.debug('Sent embeds.');
				break;
			} case 'link': {
				if (args.length !== 2) {
					msg.channel.stopTyping(true);
					return msg.reply('You must provide a LastFM username to link it to your Discord account.');
				}
				const userData = await LastFMDB.findOne({
					where: {
						userId: msg.author.id
					}
				});
				if ((await r(`&method=user.getinfo&user=${args[1]}`)).message === 'User not found') {
					msg.channel.stopTyping(true);
					return msg.reply('Specified user does not exist.');
				}
				if (userData) {
					await userData.update({
						lfmUsername: args[1]
					});
				} else {
					await LastFMDB.create({
						userId: msg.author.id,
						lfmUsername: args[1]
					});
				}
				msg.channel.stopTyping(true);
				await msg.reply(`Your Discord account has successfully been linked with LastFM account ${args[1]}.`);
				break;
			} case 'top10': {
				if (args[1] === 'help') {
					msg.channel.stopTyping(true);
					await msg.reply(`Parameters for this sub-command (\`*\` denotes the default if omitted):
**type:** \`albums | artists | tracks (*)\`
**timescale:** \`overall (*) | 7day | 1month | 3month | 6month | 12month\``);
				} else {
					const typeOptions = ['albums', 'artists', 'tracks'];
					const timescaleOptions = {
						overall: 'overall',
						'7day': 'in the past seven days',
						'1month': 'in the past month',
						'3month': 'in the past three months',
						'6month': 'in the past six months',
						'12month': 'in the past year'
					};
					let user = userData.lfmUsername;
					let type = args[1] || 'tracks';
					let timescale = args[2] || 'overall';
					if (!typeOptions.includes(type)) {
						if ((await r(`&method=user.getinfo&user=${args[1]}`)).message === 'User not found') {
							msg.channel.stopTyping(true);
							return msg.reply(`${args[1]} is an invalid user or top 10 type. Please select a valid last.fm user or choose a type from \`${typeOptions.join(' | ')}`);
						}
						user = args[1];
						type = args[2] || 'tracks';
						if (!typeOptions.includes(type)) {
							msg.channel.stopTyping(true);
							return msg.reply(`${type} is an invalid top10 timescale. Please choose one from \`${typeOptions.join(' | ')}\``);
						}
						timescale = args[3] || 'overall';
					}
					if (!Object.keys(timescaleOptions).includes(timescale)) {
						msg.channel.stopTyping(true);
						return msg.reply(`${timescale} is an invalid top10 timescale. Please choose one from \`${Object.keys(timescaleOptions).join(' | ')}\``);
					}
					log.debug('Found user.');
					if ((await r(`&method=user.getinfo&user=${user}`)).message === 'User not found') {
						msg.channel.stopTyping(true);
						return msg.reply('Specified user does not exist.');
					}
					const top10 = await r(`&method=user.gettop${type}&user=${user}&period=${timescale}&limit=10`);
					const embed = new Discord.RichEmbed({
						author: {
							name: `Top 10 ${type} ${timescaleOptions[timescale]} for ${user}`,
							icon_url: 'https://cdn.artemisbot.uk/img/lastfm.png',
							url: `https://last.fm/user/${user}`
						},
						color: 0xD51007,
						footer: {
							text: `Powered by the last.fm API. Took ${moment().diff(msg.createdAt)} ms.`
						}
					});
					const goodData = top10[`top${type}`][type.slice(0, -1)];
					for (const thing of goodData) {
						const name = type === 'artists' ? `${thing.name}` : `${thing.name} - ${thing.artist.name}`;
						let inline = true;
						if (goodData.indexOf(thing) < 9) {
							const nextName = type === 'artists' ? `${goodData[goodData.indexOf(thing) + 1].name}` : `${goodData[goodData.indexOf(thing) + 1].name} - ${goodData[goodData.indexOf(thing) + 1].artist.name}`;
							inline = name.length < 30 ? nextName.length < 60 : nextName.length < 40;
						}
						// Console.log(inline);
						embed.addField(name, `[Played ${thing.playcount} ${thing.playcount === 1 ? 'time' : 'times'}](${safeLink(thing.url)})`, inline);
					}
					msg.channel.stopTyping(true);
					await msg.channel.send('', embed);
				}
				break;
			} case 'help': {
				const embed = new Discord.RichEmbed({
					color: 2212073,
					title: 'LastFM Query Command',
					description: `*Where username is optional, you must have linked your LastFM account to your Discord account.*`,
					fields: [
						{
							name: '`lastfm link [username]`',
							value: 'Links your Discord and last.fm accounts.'
						},
						{
							name: '`lastfm nowplaying [optional:username]`',
							value: 'Fetches currently playing/last played song for user.'
						},
						{
							name: '`lastfm top10 [help | optional:type] [optional:timescale] [optional:username]`',
							value: 'Fetches your top10 albums/tracks/artists over a timescale. See `lastfm top10 help` for more information.'
						}
					]
				});
				msg.channel.stopTyping(true);
				await msg.channel.send('', embed);
				break;
			} default:
				msg.channel.stopTyping(true);
				break;
		}
	} catch (err) {
		msg.channel.stopTyping(true);
		log.error(`Something went wrong: ${err}.`);
	}
};