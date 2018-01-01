var EventManager = require('./eventmanager').EventManager;
const Beam = require('beam-client-node');
const ws = require('ws');

exports.extend = function (server) {
	/*
	 * IRC channels
	 */

	server.channels = new EventManager({
		'join':
		function (client, channel) {

			if (channel.indexOf(',') > -1)
			{ 
				channels = channel.split(',');
				for (var i = 0, len = channels.length; i < len; i++)
				{
					server.channels.negotiate('join', client, channels[i]);
				}
				return;
			}

			console.log(client);
			let BeamClient = new Beam.Client(new Beam.DefaultRequestRunner());
			var channelInfo;

			console.log(channel);
			var beamChannel = (channel[0] == '#') ? channel.slice(1) : channel;
			channel = channel[0] == '#' ? channel : '#' + channel;
			var beamUsers = [];

			BeamClient.request('GET', 'channels/' + beamChannel)
				.then(response => {
					console.log(response.body);

					// Store the logged in user's details for later refernece
					channelInfo = response.body;
					if (beamChannel.toUpperCase() != channelInfo.token.toUpperCase())
					{
						server.channels.negotiate('join', client, channelInfo.token);
						return;
					}
					beamChannel = channelInfo.token;

					// Returns a promise that resolves with our chat connection details.
					return new Beam.ChatService(BeamClient).join(response.body.id);
				})
				.then(response => {
					const body = response.body;
					console.log(body);
					return createBeamChatSocket(null, channelInfo.id, body.endpoints, body.authkey);
				})
				.catch(error => {
					console.error('Something went wrong.');
					console.error(error);
					if (error.statusCode == 404 && error.message == 'Channel not found.')
					{
						var systemUser = { name : 'Mixer', hostname: 'Mixer@0.chat.mixer.com' };
						server.channels.negotiate('deliver', channel, systemUser, 'PRIVMSG', [channel, error.message], true);
						server.channels.negotiate('deliver', channel, client, 'PART', [channel]);
						return;
					}
				});

			function createBeamChatSocket(userId, channelId, endpoints, authkey)
			{
				// Chat connection
				const socket = new Beam.Socket(ws, endpoints).boot();

				var beamChannel = { name : channelInfo.token, hostname: channelInfo.userId + '@' + channelInfo.userId + '.chat.mixer.com' };
			
				// Greet a joined user
				socket.on('UserJoin', data => {
					//socket.call('msg', [`Hi ${data.username}! I'm pingbot! Write !ping and I will pong back!`]);
					beamUser = { name: data.username, hostname: data.id + '@' + data.id + '.chat.mixer.com' };
					if (beamUser.name.toUpperCase() != client.name.toUpperCase())
					{
						beamUser.operator = (data.roles.indexOf('Mod') != -1 || data.roles.indexOf('Owner') != -1 || data.roles.indexOf('Staff') != -1);
						server.channels.negotiate('deliver', channel, beamUser, 'JOIN', [channel]);
						if (beamUser.operator)
						{
							server.channels.negotiate('deliver', channel, beamChannel, 'MODE', [channel, '+o ' + data.username], true);
						}
						//server.channels.list[channel].users[data.username] = { 'rcp': { 'deliver': function () {} } };
						beamUsers[data.id] = beamUser;
					}
				});
			
				socket.on('UserLeave', data => {
					//socket.call('msg', [`Hi ${data.username}! I'm pingbot! Write !ping and I will pong back!`]);
					beamUser = { name: data.username, hostname:  data.id + '@' + data.id + '.chat.mixer.com' };
					if (beamUser.name.toUpperCase() != client.name.toUpperCase())
					{
						server.channels.negotiate('deliver', channel, beamUser, 'PART', [channel]);
						//if (server.channels.list[channel].users.hasOwnProperty(data.username))
						if(beamUsers.hasOwnProperty(data.id))
						{
							//delete server.channels.list[channel].users[data.username];
							if (beamUsers[data.id].operator)
							{
								server.channels.negotiate('deliver', channel, beamChannel, 'MODE', [channel, '-o ' + data.username], true);
							}
							delete beamUsers[data.id];
						}
					}
				});
			
				// React to our !pong command
				socket.on('ChatMessage', data => {											
					var messageText = '';
					for (var i = 0; i < data.message.message.length; i++)
					{
						messageText += data.message.message[i].text;
					}
					console.log(data.user_name, ': ', messageText);
					beamUser = { name: data.user_name, hostname:  data.user_id + '@' + data.user_id + '.chat.mixer.com' };
					
					beamUser.operator = (data.user_roles.indexOf('Mod') != -1 || data.user_roles.indexOf('Owner') != -1 || data.user_roles.indexOf('Staff') != -1);
					if (beamUsers.hasOwnProperty(data.user_id) && beamUsers[data.user_id].operator != beamUser.operator)
					{
						beamUsers[data.user_id].operator = beamUser.operator;
						server.channels.negotiate('deliver', channel, beamChannel, 'MODE', [channel, (beamUsers[data.user_id].operator == true ? '+' : '-') + 'o ' + data.user_name], true);
					}

					if (beamUsers.hasOwnProperty(data.user_id) && beamUsers[data.user_id].name != beamUser.name)
					{
						beamUsers[data.user_id].name = beamUser.name;
					}

					if (!beamUsers.hasOwnProperty(data.user_id))
					{
						server.channels.negotiate('deliver', channel, beamUser, 'JOIN', [channel]);
						if (beamUser.operator)
						{
							server.channels.negotiate('deliver', channel, beamChannel, 'MODE', [channel, '+o ' + data.user_name], true);
						}
						//server.channels.list[channel].users[data.user_name] = { 'rcp': { 'deliver': function () {} } };
						beamUsers[data.user_id] = beamUser;
						
					}
					if (data.message.meta.whisper == true)
					{
						server.channels.negotiate('deliver', channel, beamUser, 'PRIVMSG', [channel, '/w ' + data.user_name + ' ' + messageText], true);
					}
					else if (data.message.meta.me == true)
					{
						server.channels.negotiate('deliver', channel, beamUser, 'PRIVMSG', [channel, "\u0001" + 'ACTION ' + messageText + "\u0001"], true);
					}
					else
					{
						server.channels.negotiate('deliver', channel, beamUser, 'PRIVMSG', [channel, messageText], true);
					}
				});
			
				// Handle errors
				socket.on('error', error => {
					console.error('Socket error');
					console.error(error);
				});

				socket.on('connect', data =>
				{
					var pageNum = 0;
					var userCount = 0;
					
					for (var i = 0, len = beamUsers.length; i < len; i++)
					{
						server.channels.negotiate('deliver', channel, beamUsers[i], 'JOIN', [channel]);
					}

					while (true)
					{
						BeamClient.request('GET', 'chats/' + channelInfo.id + '/users?limit=50&page' + pageNum)
						.then(response => {
							console.log(response.body);
							
							userCount = response.body.length;
							var chatUsers = response.body;
							for (var i = 0, len = chatUsers.length; i < len; i++)
							{
								beamUser = { name: chatUsers[i].userName, hostname: chatUsers[i].userId + '@' + chatUsers[i].userId + '.chat.mixer.com' };
								beamUser.operator = (chatUsers[i].userRoles.indexOf('Mod') != -1 || chatUsers[i].userRoles.indexOf('Owner') != -1 || data.userRoles.indexOf('Staff') != -1);
								beamUsers[chatUsers[i].userId] = beamUser;
								server.channels.negotiate('deliver', channel, beamUser, 'JOIN', [channel]);
								if (beamUser.operator)
								{
									server.channels.negotiate('deliver', channel, beamChannel, 'MODE', [channel, '+o ' + data.username], true);
								}
							}
							
							return;
						})
						.catch(error => {
							console.error('Something went wrong.');
							console.error(error);
						});
						if (userCount < 50)
						{
							break;
						}
						else
						{
							pageNum++;
						}
					}
				});
			
				return socket.auth(channelId, userId, authkey)
				.then(() => {
					console.log('Login successful');
					//return socket.call('msg', ['Hi! I\'m pingbot! Write !ping and I will pong back!']);
				});
			}

			var ch = server.channels.list[channel],
				scand;
			if (!ch) {
				ch = server.channels.negotiate('create', channel, client);
			}
			scand = client.name.toScandinavianLowerCase();
			if (ch.users[scand]) {
				return;
			}
			ch.users[scand] = client;
			client.channels[channel] = ch;
			server.channels.negotiate('deliver', channel, client, 'JOIN',
					[channel]);
		},

		'deliver':
		function (channel, client, cmd, args, except) {
			var target = server.channels.list[channel],
				recipients, recipient, rcp, argscopy, i, l;
			if (!target) {
				client.deliver(server.name, 401,
						[client.name, channel, 'No such nick/channel']);
				return;
			}

			recipients = target.users;
			for (recipient in recipients) {
				if (recipients.hasOwnProperty(recipient)) {
					rcp = recipients[recipient];
					if (except && rcp === client) {
						continue;
					}
					argscopy = [];
					for (i = 0, l = args.length; i < l; i += 1) {
						argscopy.push(args[i]);
					}
					rcp.deliver(client.name + '!' + client.hostname,
							cmd, argscopy);
				}
			}
		},

		'create':
		function (channel, client) {
			var ch = server.channels.list[channel] = {users: {}, topic: '',
					mode: '', usermodes: {}};
			return ch;
		},

		'part':
		function (client, channel, message) {
			var ch = server.channels.list[channel],
				i, scand, empty;
			if (!ch) {
				client.deliver(server.name, 401,
				               [client.name, channel, 'No such nick/channel']);
				return;
			}
			scand = client.name.toScandinavianLowerCase();
			if (!ch.users[scand]) {
				client.deliver(server.name, 442,
						[client.name, channel, "You're not on that channel"]);
				return;
			}
			server.channels.negotiate('deliver', channel, client, 'PART',
					[channel, message]);
			delete ch.users[scand];
			delete client.channels[channel];
			empty = true;
			for (i in ch.users) {
				if (ch.users.hasOwnProperty(i)) {
					empty = false;
					break;
				}
			}
			if (empty) {
				server.channels.negotiate('destroy', channel);
			}
		},

		'destroy': function (channel) {
			var ch = server.channels.list[channel],
				empty = true,
				i;
			if (!ch) {
				throw 'No such channel ' + channel;
			}
			for (i in ch.users) {
				if (ch.users.hasOwnProperty(i)) {
					empty = false;
					break;
				}
			}
			if (!empty) {
				throw "Can't destroy channel, not empty";
			}
			delete server.channels.list[channel];
		}
	});

	server.channels.list = {};
	
	/*
	 * Extended things
	 */
	
	// Channels can be in recipient lists

	server.messaging.override('deliver', function (client, to, message) {
		// delegate to server.channels
		if (server.channels && (to.charAt(0) === '#' || to.charAt(0) === '&')) {
			return server.channels.negotiate('deliver', to, client, 'PRIVMSG',
					[to, message], true);
		} else {
			return this.next(client, to, message);
		}
	});

	/*
	 * Commands
	 */

	//    Command: JOIN
	// Parameters: <target>
	server.commands.default('JOIN', function (client, target) {
		server.channels.negotiate('join', client, target);
	});
	
	//    Command: PART
	// Parameters: <target> <message>
	server.commands.default('PART', function (client, target, message) {
		server.channels.negotiate('part', client, target, message);
	});
};
