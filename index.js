const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const uuid = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

const port = process.env.PORT || 3030;

app.use(express.static('public'));

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

const usedNicknames = {};

function isNicknameAvailable(nickname) {
    return !usedNicknames[nickname];
}

function setNickname(client, nickname) {
    client.nickname = nickname;
    usedNicknames[nickname] = true;
}

function removeNickname(client) {
    delete usedNicknames[client.nickname];
    client.nickname = null;
}

const MAX_PLAYERS_PER_GAME = 4;
const games = {};
const nroEnemigos = 3;

function findGame(client) {
    client.axis = {
        ArrowUp: false,
        ArrowDown: false,
        ArrowLeft: false,
        ArrowRight: false,
    };
    for (const gameId in games) {
        const game = games[gameId];
        if (game.players.length < MAX_PLAYERS_PER_GAME && game.status === 'waiting') {
            game.players.push(client);
            client.join(gameId);
            client.gameId = gameId;
            client.status = 'findingGame';
            client.position = game.players.length;
            client.location = {
                x: 25 + (client.position - 1) * 125,
                y: 475,
            }
            client.emit('gameJoined', {
                player: {
                    id: client.id,
                    nickname: client.nickname,
                    status: 'findingGame',
                },
                game: {
                    gameId: game.id, status: game.status, enemys: game.enemys, roadLines: game.roadLines, players: game.players.map((player) => {
                        return {
                            nickname: player.nickname,
                            position: player.position,
                            location: player.location,
                        }
                    })
                }
            });
            client.broadcast.to(game.id).emit('playerJoined', { nickname: client.nickname });
            if (game.players.length === MAX_PLAYERS_PER_GAME) {
                startGame(client);
            }
            return game;
        }
    }
    const gameId = uuid.v4();
    const game = { id: gameId, players: [client], status: 'waiting', seconds: 5, roadLines: [] };
    games[gameId] = game;
    client.join(gameId);
    client.gameId = gameId;
    client.status = 'findingGame';
    client.position = game.players.length;
    console.log('client position', client.position);
    client.location = {
        x: 25,
        y: 475,
    }
    client.emit('gameJoined', {
        player: {
            id: client.id,
            nickname: client.nickname,
            status: 'findingGame',
        },
        game: {
            gameId: game.id, status: game.status, enemys: game.enemys, roadLines: game.roadLines, players: game.players.map((player) => {
                return {
                    nickname: player.nickname,
                    position: player.position,
                    location: player.location,
                    status: player.status,
                }
            })
        }
    });
    return game;
}

function removePlayer(client) {
    const gameId = client.gameId;
    if (gameId) {
        const game = games[gameId];
        if (game && game.status === 'waiting' || game.status === 'finished') {
            const index = game.players.indexOf(client);
            if (index !== -1) {
                game.players.splice(index, 1);
                client.leave(gameId);
                client.gameId = null;
                if (game.players.length === 0) {
                    delete games[gameId];
                } else {
                    for (let i = index; i < game.players.length; i++) {
                        game.players[i].position = i + 1;
                        game.players[i].location = {
                            x: 25 + i * 125,
                            y: 475,
                        }
                    }
                    client.broadcast.to(gameId).emit('playerLeft', { nickname: client.nickname });
                }
            }
        }
        delete usedNicknames[client.nickname];
        client.status = 'disconnected';
    }
}

function removeGame(gameId) {
    const game = games[gameId];
    if (game) {
        game.players.forEach((player) => {
            player.leave(gameId);
            player.gameId = null;
        });
    }
    delete games[gameId];
}

function startGame(client) {
    const game = games[client.gameId];
    if (game) {
        game.status = 'started';
        game.players.forEach((player) => {
            player.status = 'playing';
        });
        game.roadLines = [];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 5; j++) {
                game.roadLines.push({
                    location: {
                        x: (i + 1) * 120,
                        y: j * 150,
                    }
                });
            }
        }
        game.enemys = [];
        for (let i = 0; i < nroEnemigos; i++) {
            game.enemys.push({
                location: {
                    x: Math.floor(Math.random() * 4) * 125 + 25,
                    y: (Math.floor(Math.random() * 4) * -150) - 150,
                },
                color: randomColor(),
            });
        }

        game.players.forEach((player) => {
            player.emit('gameStarted', {
                gameId: game.id, status: game.status, enemys: game.enemys, seconds: game.seconds, roadLines: game.roadLines, players: game.players.map((player) => {
                    return {
                        nickname: player.nickname,
                        position: player.position,
                        location: player.location,
                        status: player.status,
                    }
                })
            });
        });
        game.interval = setInterval(() => {
            game.seconds--;
            updateGame(client);
        }, 1000);
    }
}

function updateGame(client) {
    const game = games[client.gameId];
    if (game) {
        if (game.seconds === 0) {
            clearInterval(game.interval);
            game.seconds = -1;
            game.interval = setInterval(() => {
                updateGame(client);
            }, 50);
            console.log('new interval');
        }
        moveLines(client.gameId);
        moveEnemys(client);
        if (game.status === 'finished') {
            clearInterval(game.interval);
        }
        movePlayers(client);
        game.players.forEach((player) => {
            player.emit('gameUpdated', {
                gameId: game.id, status: game.status, enemys: game.enemys, winner: game.winner, seconds: game.seconds, roadLines: game.roadLines, players: game.players.map((player) => {
                    return {
                        nickname: player.nickname,
                        position: player.position,
                        location: player.location,
                        status: player.status,
                    }
                })
            });
        });
    }
}

function randomColor() {
    function c() {
        let hex = Math.floor(Math.random() * 256).toString(16);
        return ("0" + String(hex)).substr(-2);
    }
    return "#" + c() + c() + c();
}

function movePlayers(client) {
    const game = games[client.gameId];
    if (game) {
        game.players.forEach((player) => {
            if (player.axis?.ArrowUp && player.location.y > player.speed) {
                player.location.y -= player.speed;
            }
            if (player.axis?.ArrowDown && player.location.y < 490) {
                player.location.y += player.speed;
            }
            if (player.axis?.ArrowLeft && player.location.x > player.speed) {
                player.location.x -= player.speed;
            }
            if (player.axis?.ArrowRight && player.location.x < 420) {
                player.location.x += player.speed;
            }
        });
    }
}

function moveLines(gameId) {
    const game = games[gameId];
    if (game) {
        game.roadLines.forEach((line) => {
            line.location.y += 10;
            if (line.location.y >= 600) {
                line.location.y = -200;
            }
        });
    }
}

function moveEnemys(client) {
    const game = games[client.gameId];
    if (game) {
        game.enemys.forEach((enemy) => {
            game.players.forEach((player) => {
                if (isCollision(player, enemy) && player.status === 'playing') {
                    player.status = 'dead';
                    let playerWinner = null;
                    let i = 0;
                    game.players.forEach((pl) => {
                        if (pl.status === 'playing') {
                            playerWinner = pl;
                            i++;
                        }
                    });
                    if (playerWinner && i === 1) {
                        game.winner = playerWinner.nickname;
                        game.status = 'finished';
                        playerWinner.status = 'connected';
                        clearInterval(game.interval);
                        game.players.forEach((ply) => {
                            ply.emit('gameFinished', {
                                gameId: game.id, status: game.status, winner: game.winner, roadLines: game.roadLines, enemys: game.enemys, players: game.players.map((player) => {
                                    return {
                                        nickname: ply.nickname,
                                        position: ply.position,
                                        location: ply.location,
                                        status: ply.status,
                                    }
                                })
                            });
                        });
                        return;
                    }
                }
            });
            if (game.status === 'finished') {
                return;
            }
            if (enemy.location.y >= 600) {
                enemy.location.x = Math.floor(Math.random() * 4) * 125 + 25;
                enemy.location.y = -150;
            }
            enemy.location.y += client.speed;
        });
    }
}

function isCollision(client, enemy) {
    if (client.location.x >= (enemy.location.x - 50) && client.location.x <= (enemy.location.x + 50) && client.location.y >= (enemy.location.y - 100) && client.location.y <= (enemy.location.y + 100)) {
        console.log('collision: ', client.nickname, enemy.location.x, enemy.location.y);
        return true;
    }
    return false;
}

io.on('connection', (client) => {
    console.log(`Client ${client.id} connected`);
    client.status = 'connected';
    client.speed = 10;
    client.axis = {};

    client.on('setNickname', (nickname) => {
        if (isNicknameAvailable(nickname)) {
            setNickname(client, nickname);
            client.emit('nicknameSet', {
                id: client.id,
                nickname: client.nickname,
                status: client.status,
            });
        } else {
            client.emit('nicknameUnavailable');
        }
    });

    client.on('joinGame', () => {
        if (!client.nickname) {
            client.emit('nicknameRequired', {});
            return;
        }
        findGame(client);
    });

    client.on('leaveGame', () => {
        removePlayer(client);
        client.emit('gameLeft', { nickname: client.nickname, status: client.status, gameId: client.gameId });
    });

    client.on('playerInput', (input) => {
        client.broadcast.to(client.gameId).emit('playerInput', { nickname: client.nickname, input });
    });

    client.on('removeGame', () => {
        removeGame(client.gameId);
        client.emit('gameRemoved');
    });

    client.on('logGames', () => {
        console.log(games);
        // if(client.gameId){
        //     console.log(games[client.gameId].players);
        // }
    });

    client.on('logUsedNicknames', () => {
        console.log(usedNicknames);
    });

    client.on('setAxis', (axis) => {
        if(client.axis){
            client.axis[axis.id] = axis.value;
        }
    });

    client.on('disconnect', () => {
        console.log(`Client ${client.id} disconnected`);
        client.status = 'disconnected';
        removePlayer(client);
        removeNickname(client);
    });

});
