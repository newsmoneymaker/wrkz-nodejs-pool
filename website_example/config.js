/* Kryptokrona (XKR) pool website settings */

// Coin name shown next to the pool name (must equal the "symbol" of the pool config)
var parentCoin = "XKR";

// Pool API: proxied by the web server from /api to the pool's API on 127.0.0.1
var api = "/api";

// Pool host name shown on the "Getting started" page
var poolHost = "xkrona.pool-pay.com";

// A notice shown above every page (empty = none)
var poolNotice = {en: "<i class=\"fa fa-bolt\"></i> It's usually more convenient to mine through <a href=\"https://all.pool-pay.com/#sec-account\">all.pool-pay.com</a> &mdash; register once, get a personal port, and the miner automatically switches to whichever pool-pay.com coin is most profitable right now (payouts available in USDT). Example: <code>poolpayminer --auto YOUR_PORT</code>.", ru: "<i class=\"fa fa-bolt\"></i> Обычно удобнее майнить через <a href=\"https://all.pool-pay.com/#sec-account\">all.pool-pay.com</a> &mdash; зарегистрируйтесь один раз, получите личный порт, и майнер сам переключается на самую выгодную монету pool-pay.com прямо сейчас (выплаты доступны в USDT). Пример: <code>poolpayminer --auto ВАШ_ПОРТ</code>."};

// Contact / community links (leave empty to hide)
var email = "admin@pool-pay.com";
var telegram = "";
var discord = "";
var github = "https://github.com/newsmoneymaker/kryptokrona-nodejs-pool";      // pool software (menu item)
var minerDownload = "/downloads/";      // poolpayminer (optional menu item; leave empty to hide)
var allPoolsUrl = "https://all.pool-pay.com/";      // link to the page listing every pool-pay.com pool

// No verified liquid XKR market was found on CoinGecko/CoinMarketCap at launch time; market widgets hidden
var marketCurrencies = [];

// Block explorer links ({id} = block height / transaction id).
var blockchainExplorer = "https://explorer.kryptokrona.org/block/{id}";
var blockExplorerId = "height";
var transactionExplorer = "https://explorer.kryptokrona.org/tx/{id}";

// Theme and default language ("en" or "ru")
var themeCss = "themes/default.css";
var defaultLang = "en";
