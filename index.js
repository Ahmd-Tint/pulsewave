// --- KEEP-ALIVE EXPRESS WEB SERVER (For UptimeRobot) ---
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is awake and running!');
});

app.listen(port, () => {
  console.log(`🌐 Keep-alive server running on port ${port}`);
});

// --- DISCORD BOT LOGIC ---
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  REST, 
  Routes, 
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');
const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const ytsr = require('@distube/ytsr');

// Credentials from Environment
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error("❌ ERROR: Missing BOT_TOKEN or CLIENT_ID in environment variables (.env file).");
  process.exit(1);
}

const LOADING_EMOJI = '⏳';

// Initialize Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Initialize DisTube Player Engine
const distube = new DisTube(client, {
  emitNewSongOnly: true,
  plugins: [new SpotifyPlugin(), new SoundCloudPlugin(), new YtDlpPlugin()]
});

// Store temporary search choices in memory: Map<userId, { targetChannel, member, textChannel }>
const tempPlayData = new Map();

// Helper: Embed generator
function createEmbed(description, color = 0x5865F2, title = null) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(description);
  if (title) embed.setTitle(title);
  return embed;
}

// Build Control Buttons (With Volume Controls)
function createMusicControlRow(queue) {
  const isPaused = queue.paused;

  const pauseBtn = new ButtonBuilder()
    .setCustomId('btn_pause')
    .setLabel(isPaused ? 'Resume' : 'Pause')
    .setEmoji(isPaused ? '▶️' : '⏸️')
    .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary);

  const skipBtn = new ButtonBuilder()
    .setCustomId('btn_skip')
    .setLabel('Skip')
    .setEmoji('⏭️')
    .setStyle(ButtonStyle.Primary);

  const stopBtn = new ButtonBuilder()
    .setCustomId('btn_stop')
    .setLabel('Stop')
    .setEmoji('⏹️')
    .setStyle(ButtonStyle.Danger);

  const volDownBtn = new ButtonBuilder()
    .setCustomId('btn_voldown')
    .setLabel('Vol -')
    .setEmoji('🔉')
    .setStyle(ButtonStyle.Secondary);

  const volUpBtn = new ButtonBuilder()
    .setCustomId('btn_volup')
    .setLabel('Vol +')
    .setEmoji('🔊')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(pauseBtn, skipBtn, stopBtn, volDownBtn, volUpBtn);
}

// Slash Command Registration
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Search and play music from YouTube, SoundCloud, Spotify, etc.')
    .addStringOption(opt => opt.setName('query').setDescription('Song title, artist, or URL').setRequired(true))
    .addChannelOption(opt => 
      opt.setName('channel')
         .setDescription('Specific Voice Channel to join (Optional)')
         .addChannelTypes(ChannelType.GuildVoice)
    ),

  new SlashCommandBuilder()
    .setName('support')
    .setDescription('Get help and support server information for this bot')
].map(cmd => cmd.toJSON());

// Register Slash Commands on Startup
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log('Registering Slash Commands globally...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Successfully registered Slash Commands!');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
});

// Interaction Handling
client.on('interactionCreate', async (interaction) => {

  // 1. SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // --- /SUPPORT COMMAND ---
    if (commandName === 'support') {
      const supportEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🛠️ Bot Support & Assistance')
        .setDescription(
          'Need help or facing issues with audio playback?\n\n' +
          '• **Multi-Source:** Supports YouTube, SoundCloud, and Spotify.\n' +
          '• **Voice Join:** Auto-detects your channel or joins specified `/play channel:`.\n' +
          '• **Smart Selector:** Discovers matching tracks across platforms and lets you pick.\n' +
          '• **Support Server:** [Click here to join Support Server](https://discord.gg/RNcu3XX82a)'
        )
        .setFooter({ text: 'Music Bot Support Center' });

      return interaction.reply({ embeds: [supportEmbed] });
    }

    // --- /PLAY COMMAND ---
    if (commandName === 'play') {
      const specifiedChannel = interaction.options.getChannel('channel');
      const userVoiceChannel = interaction.member?.voice?.channel;
      
      const targetChannel = specifiedChannel || userVoiceChannel;

      // Voice channel check
      if (!targetChannel) {
        return interaction.reply({
          embeds: [createEmbed('❌ You must join a voice channel OR specify a channel in the command for me to play music!', 0xED4245)],
          ephemeral: true
        });
      }

      const query = interaction.options.getString('query');

      // Direct URL Handling
      if (query.startsWith('http://') || query.startsWith('https://')) {
        await interaction.reply({
          embeds: [createEmbed(`${LOADING_EMOJI} **Connecting to \`${targetChannel.name}\` and loading link...**`, 0x5865F2)]
        });

        try {
          await distube.play(targetChannel, query, {
            textChannel: interaction.channel,
            member: interaction.member
          });
          return interaction.editReply({
            embeds: [createEmbed(`✅ Joined **${targetChannel.name}** and started playback!`, 0x57F287)]
          });
        } catch (err) {
          return interaction.editReply({
            embeds: [createEmbed(`❌ Error loading track: \`${err.message}\``, 0xED4245)]
          });
        }
      }

      // Search Query Logic
      await interaction.reply({
        embeds: [createEmbed(`${LOADING_EMOJI} **Searching for \`${query}\`...**`, 0x5865F2)]
      });

      try {
        // Use @distube/ytsr to resolve multi-result queries safely
        const searchResults = await ytsr(query, { limit: 5 });
        const items = searchResults.items.filter(item => item.type === 'video');

        if (!items || items.length === 0) {
          return interaction.editReply({
            embeds: [createEmbed(`❌ No results found for **"${query}"**`, 0xED4245)]
          });
        }

        // --- SINGLE RESULT CASE: Play directly without Dropdown ---
        if (items.length === 1) {
          await interaction.editReply({
            embeds: [createEmbed(`${LOADING_EMOJI} **Found 1 match. Connecting to \`${targetChannel.name}\`...**`, 0x5865F2)]
          });

          await distube.play(targetChannel, items[0].url, {
            textChannel: interaction.channel,
            member: interaction.member
          });

          return interaction.editReply({
            embeds: [createEmbed(`✅ Joined **${targetChannel.name}** and playing track!`, 0x57F287)]
          });
        }

        // --- MULTIPLE RESULTS CASE: Build Interactive Dropdown Menu ---
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_song')
          .setPlaceholder('Choose a platform/track version to play...');

        items.forEach((track, idx) => {
          const author = track.author?.name || 'Unknown Author';
          const duration = track.duration || 'N/A';
          selectMenu.addOptions({
            label: `${idx + 1}. ${track.name.substring(0, 80)}`,
            description: `Author: ${author.substring(0, 25)} | Duration: ${duration}`,
            value: track.url
          });
        });

        const row = new ActionRowBuilder().addComponents(selectMenu);

        // Save context for selection handler
        tempPlayData.set(interaction.user.id, { 
          targetChannel, 
          member: interaction.member, 
          textChannel: interaction.channel 
        });

        await interaction.editReply({
          embeds: [createEmbed('🎵 **Multiple matches found. Select your version:**', 0x5865F2)],
          components: [row]
        });

      } catch (err) {
        await interaction.editReply({
          embeds: [createEmbed(`❌ Search failed: \`${err.message}\``, 0xED4245)]
        });
      }
    }
  }

  // 2. DROPDOWN SELECTION HANDLER
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_song') {
    const selectedUrl = interaction.values[0];
    const playData = tempPlayData.get(interaction.user.id);

    if (!playData) {
      return interaction.reply({ content: '⚠️ Selection timed out or is invalid.', ephemeral: true });
    }

    await interaction.update({
      embeds: [createEmbed(`${LOADING_EMOJI} **Joining \`${playData.targetChannel.name}\` & starting track...**`, 0x5865F2)],
      components: []
    });

    try {
      await distube.play(playData.targetChannel, selectedUrl, {
        textChannel: playData.textChannel,
        member: playData.member
      });
      tempPlayData.delete(interaction.user.id);
    } catch (err) {
      await interaction.followUp({ embeds: [createEmbed(`❌ Playback error: \`${err.message}\``, 0xED4245)] });
    }
  }

  // 3. BUTTON CONTROLS HANDLER
  if (interaction.isButton()) {
    const queue = distube.getQueue(interaction.guildId);

    if (!queue) {
      return interaction.reply({
        embeds: [createEmbed('⚠️ Nothing is currently playing in this server!', 0xFEE75C)],
        ephemeral: true
      });
    }

    const { customId } = interaction;

    if (customId === 'btn_pause') {
      if (queue.paused) queue.resume();
      else queue.pause();
      await interaction.update({ components: [createMusicControlRow(queue)] });
    } 
    else if (customId === 'btn_skip') {
      try {
        await queue.skip();
        await interaction.reply({ embeds: [createEmbed('⏭️ Skipped to next track!', 0x57F287)], ephemeral: true });
      } catch (e) {
        await interaction.reply({ embeds: [createEmbed('⚠️ No more tracks left in queue!', 0xFEE75C)], ephemeral: true });
      }
    } 
    else if (customId === 'btn_stop') {
      queue.stop();
      await interaction.reply({ embeds: [createEmbed('⏹️ Stopped playback and cleared queue.', 0xED4245)] });
    } 
    else if (customId === 'btn_voldown') {
      const newVol = Math.max(queue.volume - 10, 0);
      queue.setVolume(newVol);
      await interaction.reply({ embeds: [createEmbed(`🔉 Volume set to **${newVol}%**`, 0x57F287)], ephemeral: true });
    }
    else if (customId === 'btn_volup') {
      const newVol = Math.min(queue.volume + 10, 100);
      queue.setVolume(newVol);
      await interaction.reply({ embeds: [createEmbed(`🔊 Volume set to **${newVol}%**`, 0x57F287)], ephemeral: true });
    }
  }
});

// --- NOW PLAYING EMBED ---
distube.on('playSong', (queue, song) => {
  let platform = 'YouTube';
  if (song.url.includes('soundcloud.com')) platform = 'SoundCloud';
  else if (song.url.includes('spotify.com')) platform = 'Spotify';

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({ name: 'Now Playing 🎵' })
    .setTitle(song.name)
    .setURL(song.url)
    .setThumbnail(song.thumbnail)
    .addFields(
      { name: '⏱️ Duration', value: `\`${song.formattedDuration}\``, inline: true },
      { name: '🌐 Platform', value: `\`${platform}\``, inline: true },
      { name: '👤 Author / Uploader', value: `\`${song.uploader?.name || 'Unknown'}\``, inline: true },
      { name: '🎧 Requested By', value: `${song.user}`, inline: true },
      { name: '🔊 Current Volume', value: `\`${queue.volume}%\``, inline: true },
      { name: '📜 Queue Length', value: `\`${queue.songs.length} song(s)\``, inline: true }
    )
    .setTimestamp();

  const row = createMusicControlRow(queue);
  queue.textChannel.send({ embeds: [embed], components: [row] });
});

client.login(BOT_TOKEN);