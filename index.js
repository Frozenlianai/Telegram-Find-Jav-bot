/** Telegram机器人的Token */
const token = '机器人的Token';
const robotName = '机器人名字';
const TelegramBot = require('node-telegram-bot-api');
const cheerio = require('cheerio');
const axios = require('axios');
const moment = require('moment');
moment.locale('zh-cn');
const vm = require('vm');
const javbusURL = "https://www.javbus.com";
const http = axios.create({
    baseURL: 'https://www.javbus.com/',
    timeout: 5000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.117 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    }
});

const bot = new TelegramBot(token, {polling: true});

//开始入口
bot.onText(/\/start/, msg => {
    bot.sendMessage(msg.chat.id, '欢迎使用番号机器人\n请输入 / 查看命令提示');
});


//简单保存工作状态
const state = {start: Date.now(), date: {}};

bot.onText(/\/state/, msg => {//最近5天工作状态
    let buffer = drawState(5);
    return bot.sendMessage(msg.chat.id, buffer);
});
bot.onText(/\/state (\d+)/, (msg, match) => {//工作状态
    let days = parseInt(match[1].trim()); // the captured "whatever"
    console.log({days});
    let buffer = drawState(days);

    return bot.sendMessage(msg.chat.id, buffer);
});

/**
 * 绘制图表
 * @param range
 * @returns {*}
 */
function drawState(range) {
    let now = moment();
    let earlyDay = moment().subtract(range, 'day');
    let date = [], data = [];
    while (earlyDay.diff(now) <= 0) {
        let dateKey = earlyDay.format('YYYY-MM-DD');
        date.push(dateKey);
        if (state.date[dateKey])
            data.push(state.date[dateKey]);
        else
            data.push(0);
        earlyDay = earlyDay.add(1, 'day');
    }
    let message = '从 ' + moment(state.start).fromNow() + ' 开始工作\n\n       日期       : 查询车牌号次数';
    date.forEach((d, i) => {
        message += '\n' + d + ' : ' + data[i];
    });
    return message;
}

let idRegex = /^([a-z]+)(?:-|_|\s)?([0-9]+)$/;

// Matches "/echo [whatever]"
bot.onText(/\/av (.+)/, async (msg, match) => {
    const today = moment().format('YYYY-MM-DD');
    if (state.date[today])
        state.date[today]++;
    else
        state.date[today] = 1;
    const chatId = msg.chat.id;
    let chartType = msg.chat.type;
    let isPrivate = chartType === 'private';
    let id = match[1].trim(); // the captured "whatever"
    console.log('请求番号', id);
    if (idRegex.test(id)) {
        id = id.match(idRegex);
        id = id[1] + '-' + id[2];
    }
    if (isPrivate)
        bot.sendMessage(chatId, `开始查找车牌号：${id} ……`);
    try {
        let result = await parseHtml(id);
        await bot.sendPhoto(chatId, result.cover);
        let max = isPrivate ? 10 : 3;
        let title = '[' + id + '] ';
        if (result.magnet.length > 0) {
            let message = result.title;
            result.magnet.every((magnet, i) => {
                message += '\n-----------\n大小: ' + magnet.size + '\n链接: ' + magnet.link.substring(0, 60);
                return (i + 1) < max;
            });
            if (!isPrivate && result.magnet.length > max) {
                message += `\n-----------\n在群聊中发车，还有 ${result.magnet.length - max} 个Magnet链接没有显示\n与 ${robotName} 机器人单聊可以显示所有链接`;
            }
            sendMessageWithTwoGroupButtons(chatId, message);
        } else {
            sendMessageWithTwoGroupButtons(chatId, title + '还没有Magnet链接');
        }
    } catch (e) {
        console.error(id, e.message);
        if (e.message.indexOf('timeout') !== -1)
            return bot.sendMessage(chatId, '机器人查询番号超时，请重试');
        bot.sendMessage(chatId, `找不到 ${id}！`);
    }
});


/**
 * 解析Javbus网页内容
 * @param id
 * @returns {{title: string, cover: string, magnet: array}}
 */
async function parseHtml(id) {
    const result = {title: '', cover: '', magnet: []};
    let response = await http.get('/' + id);
    // fs.writeFileSync('./1.html', response.data);
    let $ = cheerio.load(response.data);
    let $image = $('a.bigImage img');
    // console.log({$image});
    result.title = $image.attr('title');
    result.cover = javbusURL + $image.attr('src');

    let ajax = {gid: '', uc: '', img: ''};
    const context = new vm.createContext(ajax);
    let $script = $('body > script:nth-child(9)');
    new vm.Script($script.html()).runInContext(context);
    let floor = Math.floor(Math.random() * 1e3 + 1);
    let url = `/ajax/uncledatoolsbyajax.php?gid=${ajax.gid}&uc=${ajax.uc}&img=${ajax.img}&lang=zh&floor=${floor}`;
    response = await http({method: 'get', url, headers: {'referer': 'https://www.javbus.com/' + id}});
    // console.log(response.data);
    // fs.writeFileSync('./2.html', response.data);
    $ = cheerio.load(response.data, {xmlMode: true, decodeEntities: true, normalizeWhitespace: true});
    let $tr = $('tr');
    if ($tr.length > 0) {
        for (let i = 0; i < $tr.length; i++) {
            let $a = $tr.eq(i).find('td:nth-child(2) a');
            if ($a.length === 0)
                continue;
            // console.log('tr', i, $a.length);
            result.magnet.push({link: decodeURI($a.attr('href').trim()), size: $a.text().trim()});
        }
    }
    // console.log(result);
    return result;
}


// 统计机器人的总用户数量和正在使用机器人的用户信息
bot.onText(/\/usercount/, async (msg) => {
  const chatId = msg.chat.id;
  const users = await bot.getUpdates();
  let message = '机器人的总用户数量：' + users.length + '\n\n';

  message += '正在使用机器人的用户信息：\n\n';
  for (let i = 0; i < users.length; i++) {
    const user = users[i].message.from;
    const userName = user.first_name + (user.last_name ? ' ' + user.last_name : '');
    const userLink = `https://t.me/${user.username}`;
    message += `用户名称: ${userName}\n链接: ${userLink}\n\n`;
  }

  bot.sendMessage(chatId, message);
});

// 记录所有群组的聊天 ID 和名称
const fs = require('fs');
const GROUPS_FILE = 'groups.json';
let chatGroups = [];
// 启动时加载本地群组信息
if (fs.existsSync(GROUPS_FILE)) {
  try {
    chatGroups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
  } catch (e) {
    console.error('加载群组信息失败:', e);
    chatGroups = [];
  }
}

function saveGroupsToFile() {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(chatGroups, null, 2), 'utf-8');
}

// 当前页数和每页显示的结果数量
let currentPage = 1;
const resultsPerPage = 20;

// 监听所有聊天消息，记录群组的聊天 ID、名称、成员数和邀请链接（只记录群聊，去重，持久化）
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const chatTitle = msg.chat.title;

  // 机器人被拉进新群
  if (msg.new_chat_members && Array.isArray(msg.new_chat_members)) {
    const isBotAdded = msg.new_chat_members.some(member => member.username === bot.me?.username);
    if (isBotAdded) {
      let memberCount = 0;
      let inviteLink = '';
      try {
        memberCount = await bot.getChatMembersCount(chatId);
      } catch (e) {
        console.error('获取群成员数失败:', e);
      }
      try {
        const chatInfo = await bot.getChat(chatId);
        inviteLink = chatInfo.invite_link || '';
      } catch (e) {
        console.error('获取群邀请链接失败:', e);
      }
      // 新增或更新群信息
      const idx = chatGroups.findIndex(group => group.chatId === chatId);
      if (idx !== -1) {
        chatGroups[idx] = { chatId, chatTitle, memberCount, inviteLink };
      } else {
        chatGroups.push({ chatId, chatTitle, memberCount, inviteLink });
      }
      saveGroupsToFile();
    }
  }

  // 机器人被踢出群
  if (msg.left_chat_member && msg.left_chat_member.username === bot.me?.username) {
    const idx = chatGroups.findIndex(group => group.chatId === chatId);
    if (idx !== -1) {
      chatGroups.splice(idx, 1);
      saveGroupsToFile();
    }
  }

  if ((chatType === 'group' || chatType === 'supergroup') && !chatGroups.some(group => group.chatId === chatId)) {
    let memberCount = 0;
    let inviteLink = '';
    try {
      memberCount = await bot.getChatMembersCount(chatId);
    } catch (e) {
      console.error('获取群成员数失败:', e);
    }
    try {
      const chatInfo = await bot.getChat(chatId);
      inviteLink = chatInfo.invite_link || '';
    } catch (e) {
      console.error('获取群邀请链接失败:', e);
    }
    chatGroups.push({ chatId, chatTitle, memberCount, inviteLink });
    saveGroupsToFile();
  }

  // 群名变更监听
  if (msg.new_chat_title) {
    const idx = chatGroups.findIndex(group => group.chatId === chatId);
    if (idx !== -1) {
      chatGroups[idx].chatTitle = msg.new_chat_title;
      saveGroupsToFile();
    }
  }
});

// 处理翻页指令
bot.onText(/\/next/, (msg) => {
  const chatId = msg.chat.id;
  const totalResults = chatGroups.length;
  const totalPages = Math.ceil(totalResults / resultsPerPage);

  if (currentPage < totalPages) {
    currentPage++;
  }

  sendResults(chatId);
});

bot.onText(/\/prev/, (msg) => {
  const chatId = msg.chat.id;

  if (currentPage > 1) {
    currentPage--;
  }

  sendResults(chatId);
});

// 发送当前页的结果
function sendResults(chatId) {
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentResults = chatGroups.slice(startIndex, endIndex);

  let response = `机器人加入的群组数量：${chatGroups.length}\n\n`;
  response += `当前页 (${currentPage}/${Math.ceil(chatGroups.length / resultsPerPage)})：\n`;

  currentResults.forEach(group => {
    response += `${group.chatTitle || '无群名'}（${group.memberCount || '未知'}人）\n`;
    if (group.inviteLink) {
      response += `进群链接: ${group.inviteLink}\n`;
    }
  });

  response += `\n使用 /next 和 /prev 进行翻页。`;

  bot.sendMessage(chatId, response);
}

// 统计群组数量和名称
bot.onText(/\/groupcount/, (msg) => {
  const chatId = msg.chat.id;
  currentPage = 1; // 重置当前页数为第一页
  sendResults(chatId);
});

const groupLink1 = 'https://t.me/your_group_link1'; // 替换为你的第一个群链接
const groupLink2 = 'https://t.me/your_group_link2'; // 替换为你的第二个群链接

function sendMessageWithTwoGroupButtons(chatId, text, extra = {}) {
  const groupButtons = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '加入官方交流群', url: groupLink1 },
          { text: '加入官方频道', url: groupLink2 }
        ]
      ]
    }
  };
  const options = { ...groupButtons, ...extra };
  bot.sendMessage(chatId, text, options);
}

// 运行机器人
bot.on('polling_error', (error) => {
  console.log(error);
});

console.log('机器人已启动');
