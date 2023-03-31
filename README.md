# Dogecoin transactions tracker
This project is a dogecoing whale transactions tracker, wich which takes advantage of dogecoin-core
blocknotify function to get notified about new blocks and parse them using dogecoin-cli RPC command
logging big whales transactions into a mysql database.

Use of collected data example: https://dogecoinlab.org/whales-alert.html

## Requirements

- a full dogecoin node with txindex enabled
- Node.js version 18

dogecoin.conf blocknotify example:

blocknotify=curl -s 'http://192.168.178.50:8000/blocknotify?blockhash=%s' >/dev/null

# Donations

To support this project you can send a donation to the following accounts:

- DOGE: DEqpxyKcz8cEWXA2xobFmot9jCG6TbGWRY
