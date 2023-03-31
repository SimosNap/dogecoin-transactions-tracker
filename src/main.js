const http = require('http');
const { exec } = require('child_process');
const mysql = require('mysql');
const jsonRpc = require('jayson/promise');
const fetch = require('node-fetch');

// Read configuration from file
const config = require('./example.conf');

// Create MySQL connection pool
const pool = mysql.createPool({
    connectionLimit: config.mysql.connectionLimit,
    host: config.mysql.host,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database
});

// Create JSON-RPC client

let base64 = require('base-64');

let url = config.dogecoinRpcUrl;
let username = config.dogecoinRpcUser;
let password = config.dogecoinRpcPassword;

const rpcClient = jsonRpc.Client.http({
    host: 'localhost',
    port: 22555,
    version: 1,
    headers: {
        'jsonrpc': '1.0',
        'Authorization': 'Basic ' + Buffer.from(username + ":" + password).toString('base64')
    },
});

const cache = {}; // Initialize cache object
const CACHE_DURATION = 5 * 60 * 1000; // Cache duration in milliseconds

// Define function to insert transaction data into MySQL database
function insertTransaction(txid, address, amount, doge_USD, time, sender) {
    const query = `INSERT INTO transactions (txid, sender, recipient, amount, doge_usd, time)
                 VALUES ('${txid}', '${sender}', '${address}', ${amount}, ${doge_USD}, '${time}')`;

    pool.query(query, (error, results) => {
        if (error) {
            console.error(error);
        }
    });
}

async function getExchangeRate() {
    const now = Date.now();
    if (cache.lastUpdated && now - cache.lastUpdated < CACHE_DURATION) {
        // Use cached value if it's still fresh
        return cache.value;
    }

    const coingecko = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=DOGECOIN&vs_currencies=USD').then((r) => {
        if (!r.ok) {
            throw new Error('request not ok ' + r.statusText);
        }
        return r.json();
    }).catch((err) => {
        console.log('Error fetching coingecko data:', err.message);
        return;
    });

    Object.assign(cache, {
        value: coingecko.dogecoin.usd,
        lastUpdated: now,
    });

    return cache.value;
}

// Define function to handle incoming blocks
async function handleBlock(blockHash) {
   //console.log(blockHash);
   const blockData = await rpcClient.request('getblock', [blockHash, true]).catch((err) => {
        console.error(`Error getting block information: ${err.message}`);
        return;
    });
    //console.log('blockData', blockData.result.tx);
    const returnBlocks = [];

    const blockTime = blockData.result.time;
    const dogeUSD = await getExchangeRate();

    // Loop through the block's transactions
    // you cannot await in a .forEach()
    for (const blockTxID of blockData.result.tx) {
        //console.log('blockTxID',blockTxID);
        const txData = await rpcClient.request('getrawtransaction', [blockTxID, true]).catch((err) => {
            console.error(`Error getting tx transaction information: ${err.message}`);
            return;
        });

        //console.log('txData',txData.result);

        if (txData.result.vin[0].coinbase) {
           console.log('COINBASE: ',txData.result.vin[0]);
           continue;
        }

        // Parse the transaction information
        const txTime = txData.result.time;
        const txAmount = txData.result.vout.reduce((acc, output) => {
            return acc + output.value;
        }, 0);

        //skip if amount is under 1.000.000 Dogecoin
        if (txAmount < 1000000) { continue; }

        // Loop through the transaction's outputs
        const outputs = [];
        const txid = txData.result.txid;
        const time = txTime;
        const date = new Date(txTime * 1000);
        const datetime = date.toISOString().split('.')[0].replace('T', ' ');

        for (const vout of txData.result.vout) {
            // Check scriptPubKey.type, have to catch all type ?
            // if ((vout.scriptPubKey.type === 'pubkeyhash') || (vout.scriptPubKey.type === 'scripthash')){
               //console.log('RECIPIENT: ', txid, vout.scriptPubKey.addresses[0]);
                outputs.push({
                    address: vout.scriptPubKey.addresses[0],
                    amount: vout.value
                });
            // }
        }

        const inputs = [];
        //const vin = txData.result.vin;
        // Retrieve RECIPIENT address from input transaction
        for (const vin of txData.result.vin) {
            const rxData = await rpcClient.request('getrawtransaction', [vin.txid, true]).catch((err) => {
                console.error(`Error getting rx transaction information: ${err.message}`);
                return;
            });

            const voutNum = vin.vout;
            const inputaddress = rxData.result.vout[voutNum];
            //console.log(inputaddress);
            //if ((inputaddress.scriptPubKey.type === 'pubkeyhash') || (inputaddress.scriptPubKey.type === 'scripthash')) {
               //console.log('SENDER: ', txid, inputaddress.scriptPubKey.addresses[0])
                inputs.push({
                    address: inputaddress.scriptPubKey.addresses[0],
                    amount: inputaddress.value,
                });
            //}
        }

        console.log('TXID: ', txid);
        console.log('AMOUNT: ', txAmount);
        console.log('TIME: ', txTime);
        console.log('RECIPIENTS: ', JSON.stringify(outputs));
        console.log('SENDERS: ', JSON.stringify(inputs));
        console.log('DOGE/USD: ', JSON.stringify(dogeUSD));
        insertTransaction(txid, JSON.stringify(outputs), txAmount, JSON.stringify(dogeUSD), datetime, JSON.stringify(inputs));
        console.log('-------------------------------------------------------------------');

        const isSameAddress = (inputs, outputs) => inputs.address === outputs.address;

        // Get items that only occur in the left array,
        // using the compareFunction to determine equality.
        // goal is exclude from logging transactions matched as big when the amount is
        // due a big unspent amount. This may need a review and may depend on what you want to log
        const onlyInLeft = (left, right, compareFunction) =>
          left.filter(leftValue =>
            !right.some(rightValue =>
              compareFunction(leftValue, rightValue)));

        const onlyInSend = onlyInLeft(inputs, outputs, isSameAddress);
        const onlyInRec = onlyInLeft(outputs, inputs, isSameAddress);

        const res = [...onlyInRec];
        console.log(res);

        const sum = res.reduce((accumulator, ob) => {
          return accumulator + ob.amount;
        }, 0);
        console.log(sum);

        //skip database insertion if amount of transaction excluding unstpent is under 1.000.000 Dogecoin
        if (sum < 1000000) { continue; }

        insertTransaction(txid, JSON.stringify(outputs), txAmount, JSON.stringify(dogeUSD), datetime, JSON.stringify(inputs));

        /*returnBlocks.push({
            inputs,
            outputs,
            dogeUSD,
            blockTime,
        })*/
    }
    //console.log(returnBlocks);
    //return returnBlocks;
}

// Start listening for incoming block notifications using HTTP server
http.createServer(async (req, res) => {
    if (req.method === 'GET') {
        try {
            // Retrieve block information
            const blockHash = req.url.split('=');
            const block = blockHash[1];
            const blocks = await handleBlock(block);
            res.end('OK');
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end();
        }
    } else {
        res.statusCode = 404;
        res.end();
    }
}).listen(8000, () => {
    console.log('Listening for incoming block notifications on port 8000...');
});
