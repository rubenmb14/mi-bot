require('dotenv').config();
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  REST,
  Routes,
} = require('discord.js');
const fs = require('node:fs');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');

const ARCHIVO_VC = './vchannel.json';

function guardarVC(guildId, channelId) {
  fs.writeFileSync(ARCHIVO_VC, JSON.stringify({ guildId, channelId }));
}

function leerVC() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_VC, 'utf8'));
  } catch {
    return null;
  }
}

function conectarVC(guild, channelId) {
  const conexion = joinVoiceChannel({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  guardarVC(guild.id, channelId);
  conexion.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(conexion, VoiceConnectionStatus.Signalling, 5000),
        entersState(conexion, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      const datos = leerVC();
      const canal = datos ? guild.channels.cache.get(datos.channelId) : null;
      if (canal && canal.isVoiceBased()) {
        joinVoiceChannel({ channelId: canal.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
        console.log(`Reconectado al canal de voz ${canal.name}.`);
      }
    }
  });
  return conexion;
}

const comandos = [];
const crear = (data, execute) => comandos.push({ data, execute });

crear(
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa a un usuario del servidor')
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario a expulsar').setRequired(true))
    .addStringOption((o) => o.setName('razon').setDescription('Motivo de la expulsión'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  async (interaction) => {
    const usuario = interaction.options.getUser('usuario', true);
    const razon = interaction.options.getString('razon') ?? 'Sin motivo especificado';
    const miembro = await interaction.guild.members.fetch(usuario.id).catch(() => null);
    if (!miembro) return interaction.reply({ content: 'No encontré a ese usuario en el servidor.', ephemeral: true });
    if (!miembro.kickable) return interaction.reply({ content: 'No puedo expulsarlo: tiene un rol superior al mío o es el dueño.', ephemeral: true });
    await miembro.kick(razon);
    await interaction.reply(`👢 **${usuario.tag}** fue expulsado.\n**Motivo:** ${razon}`);
  }
);

crear(
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banea a un usuario del servidor')
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario a banear').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('borrar_mensajes').setDescription('Días de mensajes suyos a borrar (0-7)').setMinValue(0).setMaxValue(7)
    )
    .addStringOption((o) => o.setName('razon').setDescription('Motivo del baneo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async (interaction) => {
    const usuario = interaction.options.getUser('usuario', true);
    const dias = interaction.options.getInteger('borrar_mensajes') ?? 0;
    const razon = interaction.options.getString('razon') ?? 'Sin motivo especificado';
    const miembro = await interaction.guild.members.fetch(usuario.id).catch(() => null);
    if (miembro && !miembro.bannable) {
      return interaction.reply({ content: 'No puedo banearlo: tiene un rol superior al mío o es el dueño.', ephemeral: true });
    }
    await interaction.guild.members.ban(usuario.id, { reason: razon, deleteMessageSeconds: dias * 86400 });
    await interaction.reply(`🔨 **${usuario.tag}** fue baneado.\n**Motivo:** ${razon}`);
  }
);

crear(
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Desbanea a un usuario usando su ID')
    .addStringOption((o) => o.setName('id').setDescription('ID del usuario a desbanear').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async (interaction) => {
    const id = interaction.options.getString('id', true);
    try {
      const usuario = await interaction.guild.bans.remove(id);
      await interaction.reply(`✅ **${usuario?.tag ?? id}** fue desbaneado.`);
    } catch {
      await interaction.reply({ content: 'No pude desbanear. Verifica que el ID sea correcto y que el usuario esté baneado.', ephemeral: true });
    }
  }
);

crear(
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Silencia a un usuario temporalmente')
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario a silenciar').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('minutos').setDescription('Duración en minutos (máximo 28 días)').setRequired(true).setMinValue(1).setMaxValue(40320)
    )
    .addStringOption((o) => o.setName('razon').setDescription('Motivo del silencio'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async (interaction) => {
    const usuario = interaction.options.getUser('usuario', true);
    const minutos = interaction.options.getInteger('minutos', true);
    const razon = interaction.options.getString('razon') ?? 'Sin motivo especificado';
    const miembro = await interaction.guild.members.fetch(usuario.id).catch(() => null);
    if (!miembro) return interaction.reply({ content: 'No encontré a ese usuario en el servidor.', ephemeral: true });
    if (!miembro.moderatable) return interaction.reply({ content: 'No puedo silenciarlo: tiene un rol superior al mío o es el dueño.', ephemeral: true });
    await miembro.timeout(minutos * 60 * 1000, razon);
    await interaction.reply(`🔇 **${usuario.tag}** fue silenciado por **${minutos} minuto(s)**.\n**Motivo:** ${razon}`);
  }
);

crear(
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Borra mensajes recientes de este canal')
    .addIntegerOption((o) =>
      o.setName('cantidad').setDescription('Cantidad de mensajes a borrar (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async (interaction) => {
    const cantidad = interaction.options.getInteger('cantidad', true);
    if (!interaction.channel.bulkDeletable) {
      return interaction.reply({ content: 'No tengo permiso para borrar mensajes en este canal.', ephemeral: true });
    }
    const borrados = await interaction.channel.bulkDelete(cantidad, true);
    await interaction.reply({ content: `🧹 Se borraron **${borrados.size}** mensajes.`, ephemeral: true });
  }
);

crear(
  new SlashCommandBuilder().setName('serverinfo').setDescription('Muestra información del servidor'),
  async (interaction) => {
    const { guild } = interaction;
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .setColor(0x5865f2)
      .addFields(
        { name: '👑 Dueño', value: `<@${guild.ownerId}>`, inline: true },
        { name: '👥 Miembros', value: `${guild.memberCount}`, inline: true },
        { name: '#️⃣ Canales', value: `${guild.channels.cache.size}`, inline: true },
        { name: '🏷️ Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true },
        { name: '📅 Creado el', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });
  }
);

crear(
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Muestra información de un usuario')
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (vacío = tú)')),
  async (interaction) => {
    const usuario = interaction.options.getUser('usuario') ?? interaction.user;
    const miembro = await interaction.guild.members.fetch(usuario.id).catch(() => null);
    const roles = miembro
      ? miembro.roles.cache.filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position).map((r) => r.toString()).slice(0, 10).join(' ') || 'Sin roles'
      : 'No está en este servidor';
    const embed = new EmbedBuilder()
      .setTitle(usuario.tag)
      .setThumbnail(usuario.displayAvatarURL({ size: 256 }))
      .setColor(miembro?.displayColor || 0x5865f2)
      .addFields(
        { name: '🆔 ID', value: usuario.id, inline: true },
        { name: '🤖 ¿Bot?', value: usuario.bot ? 'Sí' : 'No', inline: true },
        { name: '📅 Cuenta creada', value: `<t:${Math.floor(usuario.createdTimestamp / 1000)}:D>`, inline: true }
      );
    if (miembro) {
      embed.addFields({ name: '📥 Entró al servidor', value: `<t:${Math.floor(miembro.joinedTimestamp / 1000)}:D>`, inline: true });
    }
    embed.addFields({ name: '🏷️ Roles', value: roles });
    await interaction.reply({ embeds: [embed] });
  }
);

crear(
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Muestra el avatar de un usuario en grande')
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (vacío = tú)')),
  async (interaction) => {
    const usuario = interaction.options.getUser('usuario') ?? interaction.user;
    await interaction.reply(`🖼️ Avatar de **${usuario.tag}**:\n${usuario.displayAvatarURL({ size: 1024 })}`);
  }
);

const NUMEROS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

crear(
  new SlashCommandBuilder()
    .setName('encuesta')
    .setDescription('Crea una encuesta con reacciones')
    .addStringOption((o) => o.setName('pregunta').setDescription('Pregunta de la encuesta').setRequired(true))
    .addStringOption((o) => o.setName('opciones').setDescription('Opciones separadas por | (ej: Sí | No | Quizá)')),
  async (interaction) => {
    const pregunta = interaction.options.getString('pregunta', true);
    const opcionesTexto = interaction.options.getString('opciones');
    if (!opcionesTexto) {
      const mensaje = await interaction.reply({ content: `📊 **${pregunta}**`, fetchReply: true });
      await mensaje.react('👍');
      await mensaje.react('👎');
      return;
    }
    const opciones = opcionesTexto.split('|').map((x) => x.trim()).filter(Boolean);
    if (opciones.length < 2 || opciones.length > NUMEROS.length) {
      return interaction.reply({ content: `Debes dar entre 2 y ${NUMEROS.length} opciones separadas por |`, ephemeral: true });
    }
    const cuerpo = opciones.map((op, i) => `${NUMEROS[i]} ${op}`).join('\n\n');
    const mensaje = await interaction.reply({ content: `📊 **${pregunta}**\n\n${cuerpo}`, fetchReply: true });
    for (let i = 0; i < opciones.length; i++) {
      await mensaje.react(NUMEROS[i]);
    }
  }
);

crear(
  new SlashCommandBuilder()
    .setName('decir')
    .setDescription('El bot repite tu mensaje')
    .addStringOption((o) => o.setName('mensaje').setDescription('Texto que el bot dirá').setRequired(true)),
  async (interaction) => {
    await interaction.deferReply();
    await interaction.editReply(interaction.options.getString('mensaje', true));
  }
);

crear(
  new SlashCommandBuilder().setName('moneda').setDescription('Lanza una moneda: cara o cruz'),
  async (interaction) => {
    await interaction.reply(Math.random() < 0.5 ? '🪙 **¡Cara!**' : '🪙 **¡Cruz!**');
  }
);

crear(
  new SlashCommandBuilder()
    .setName('dado')
    .setDescription('Lanza un dado')
    .addIntegerOption((o) =>
      o.setName('caras').setDescription('Número de caras del dado (por defecto 6)').setMinValue(2).setMaxValue(1000)
    ),
  async (interaction) => {
    const caras = interaction.options.getInteger('caras') ?? 6;
    const resultado = Math.floor(Math.random() * caras) + 1;
    await interaction.reply(`🎲 Sacaste un **${resultado}** (d${caras})`);
  }
);

const RESPUESTAS_BOLA8 = [
  'Sí, definitivamente. ✅',
  'No cuentes con eso. ❌',
  'Todo apunta a que sí. 🔮',
  'Mejor no te lo digo ahora. 🤐',
  'Es muy probable. 👍',
  'Mis fuentes dicen que no. 📉',
  'Sin duda alguna. 💯',
  'Concéntrate y vuelve a preguntar. 🌀',
  'Pinta bien. ✨',
  'Ni loco. 🙅',
];

crear(
  new SlashCommandBuilder()
    .setName('bola8')
    .setDescription('Hazle una pregunta a la bola mágica')
    .addStringOption((o) => o.setName('pregunta').setDescription('Tu pregunta para la bola mágica').setRequired(true)),
  async (interaction) => {
    const respuesta = RESPUESTAS_BOLA8[Math.floor(Math.random() * RESPUESTAS_BOLA8.length)];
    await interaction.reply(`🎱 *"${interaction.options.getString('pregunta', true)}"*\n\n${respuesta}`);
  }
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

crear(
  new SlashCommandBuilder()
    .setName('vc')
    .setDescription('El bot se une a tu canal de voz y se queda dentro siempre'),
  async (interaction) => {
    const miembro = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const canalVoz = miembro?.voice.channel;
    if (!canalVoz) {
      return interaction.reply({ content: 'Primero entra a un canal de voz.', ephemeral: true });
    }
    if (interaction.channelId !== canalVoz.id) {
      return interaction.reply({ content: 'Usa este comando en el chat del canal de voz en el que estás.', ephemeral: true });
    }
    const permisos = canalVoz.permissionsFor(interaction.guild.members.me);
    if (!permisos?.has(PermissionFlagsBits.Connect) || !permisos?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({ content: 'Necesito los permisos Conectar y Hablar en ese canal.', ephemeral: true });
    }
    try {
      conectarVC(interaction.guild, canalVoz.id);
      await interaction.reply(`🔊 Me he unido a **${canalVoz.name}** y no me voy a ir.`);
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'No pude unirme al canal de voz.', ephemeral: true });
    }
  }
);

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase().includes('alvarilloo')) {
    message.reply('quesito');
    return;
  }
  if (message.content.startsWith('>')) {
    const texto = message.content.slice(1).trim();
    if (!texto) return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    await message.delete().catch(() => {});
    await message.channel.send(texto);
  }
});

client.commands = new Collection();
for (const comando of comandos) client.commands.set(comando.data.name, comando);

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot conectado como ${c.user.tag}`);
  c.user.setActivity('vigilando el servidor 24/7');
  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(c.application.id, process.env.GUILD_ID), {
      body: comandos.map((comando) => comando.data.toJSON()),
    });
    console.log(`${comandos.length} comandos registrados correctamente.`);
  } catch (error) {
    console.error('Error al registrar los comandos:', error);
  }
  const datosVC = leerVC();
  if (datosVC) {
    const guild = c.guilds.cache.get(datosVC.guildId);
    const canal = guild?.channels.cache.get(datosVC.channelId);
    if (canal?.isVoiceBased()) {
      console.log(`Volviendo al canal de voz ${canal.name}...`);
      setTimeout(() => conectarVC(guild, canal.id), 3000);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const comando = client.commands.get(interaction.commandName);
  if (!comando) return;
  try {
    await comando.execute(interaction);
  } catch (error) {
    console.error(error);
    const respuesta = { content: 'Hubo un error al ejecutar este comando.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(respuesta);
    } else {
      await interaction.reply(respuesta);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
