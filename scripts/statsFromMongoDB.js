var mongoose = require('mongoose')
  , lib = require('../lib/explorer')
  , db = require('../lib/database')
  , settings = require('../lib/settings')
  , LocationNodes = require('../models/locationnodes')
  , Nodes = require('../models/nodes')
  , Address = require('../models/address')
  , Stats = require('../models/stats')
  , Inf = require('../models/infnodes')
  , Tx = require('../models/tx')
  , Pools = require('../models/pools')
  , request = require('request');

var COUNT = 5000; //number of blocks to index

var statsName = '';

function  usage(){
  console.log('Usage: node scripts/statsFromMongoDB.js [statsName]');
  console.log('');
  console.log('statsName: (required)');
  console.log('topAddress            calcul Top10 and Top50 and update coinstats');
  console.log('activeAddress         number of address has sup 10SIN in balance');
  console.log('totalAddress          total address used from block genesis');
  console.log('nodeBurnCoins         total coins burnt to create node');
  console.log('knownHashrate         total hashrate from all known pools');
  console.log('infCreateAndOnline    total node create and online');
  console.log('infExpired            infinity node expired stats');
  console.log('tx7days               number and amount of 7 previous days');
  console.log('');
  process.exit(0);
}

if (process.argv.length != 3) {
  usage();
} else {
  statsName = process.argv[2];
}

function exit() {
  mongoose.disconnect();
  process.exit(0);
}

var dbString = 'mongodb://' + settings.dbsettings.user;
dbString = dbString + ':' + settings.dbsettings.password;
dbString = dbString + '@' + settings.dbsettings.address;
dbString = dbString + ':' + settings.dbsettings.port;
dbString = dbString + '/' + settings.dbsettings.database;

mongoose.connect(dbString, function(err) {
  if (err) {
    console.log('Unable to connect to database: %s', dbString);
    console.log('Aborting');
    exit();
  } else {
    //BEGIN
    const data = {addresses: 0, active: 0, top10: 0, top50: 0};
    console.log('calcul stats: '+statsName);
    if (statsName == 'topAddress'){
      Address.find({}).sort({balance: 'desc'}).limit(50).exec(function(err, addresses){
        if (err) {
          console.log("ERROR: can not get address collection");
          exit();
        }else{
          var address;
          for (var i=0; i < addresses.length; i++ ){
            address = addresses[i];
            if (i >=1 && i <=9){
              data.top10 = data.top10 + address.balance / 100000000;
            }
            if (i >=10 && i <=49){
              data.top50 = data.top50 + address.balance / 100000000;
            }
          }
          Stats.updateOne({coin: settings.coin}, {
            top10: data.top10,
            top50: data.top50,
          }, function() {exit();});
          console.log("INFO: updated top10 and top50");
        }
      });
    } else if (statsName == 'activeAddress'){
      Address.find({balance: {$gt: 100000000}}).exec(function(err, addresses){
          data.active = addresses.length;
          Stats.updateOne({coin: settings.coin}, {
              active_addresses: addresses.length,
          }, function() {exit();});
        console.log("INFO: updated Active address");
      });
    } else if (statsName == 'totalAddress'){
      Address.countDocuments().exec(function(err, count){
        data.addresses = count;
        Stats.updateOne({coin: settings.coin}, {
            addresses: count,
        }, function() {exit();});
        console.log("INFO: updated Total Address");
      });
    } else if (statsName == 'nodeBurnCoins'){
      Inf.find({}).exec(function(err, infnodes){
        var nodeburn = 0;
        var node;
        for (var i=0; i < infnodes.length; i++ ){
          node = infnodes[i];
          nodeburn = nodeburn + node.burnvalue;
        }
        Stats.updateOne({coin: settings.coin}, {
            node_burn: nodeburn
        }, function() {exit();});
        console.log("INFO: updated Total coins burnt for node");
      });
    } else if (statsName == 'knownHashrate'){
      Pools.find({}).exec(function(err, pools){
        var hashrate = 0;
        for (var i=0; i < pools.length; i++ ){
          var hashrate = hashrate + pools[i].pool_hashrate;
        }
        Stats.updateOne({coin: settings.coin}, {
            known_hashrate: hashrate
        }, function() {exit();});
        console.log("INFO: updated Known Hashrate "+ hashrate);
      });
    } else if (statsName == 'infCreateAndOnline'){
      db.get_stats(settings.coin, function(stats){
        var deamonH  = stats.count;
        Inf.find({}).exec(function(err, infnodes){
          var node;
          var totalBIG = 0, totalMID = 0, totalLIL = 0;
          var onlineBIG = 0, onlineMID = 0, onlineLIL = 0;
          for (var i=0; i < infnodes.length; i++ ){
            var node = infnodes[i];
            if(node.type == 10) {totalBIG = totalBIG + 1;}
            if(node.type == 5)  {totalMID = totalMID + 1;}
            if(node.type == 1)  {totalLIL = totalLIL + 1;}
            if(node.last_paid >= deamonH - node.last_stm_size && node.type == 10) {onlineBIG = onlineBIG + 1;}
            if(node.last_paid >= deamonH - node.last_stm_size && node.type == 5)  {onlineMID = onlineMID + 1;}
            if(node.last_paid >= deamonH - node.last_stm_size && node.type == 1)  {onlineLIL = onlineLIL + 1;}
          }
          Stats.updateOne({coin: settings.coin}, {
            inf_burnt_big: totalBIG,
            inf_burnt_mid: totalMID,
            inf_burnt_lil: totalLIL,
            inf_online_big: onlineBIG,
            inf_online_mid: onlineMID,
            inf_online_lil: onlineLIL,
          }, function() {exit();});
          console.log("INFO: update totalBID: " + totalBIG + " totalMID: " + totalMID + " totalLIL: " + totalLIL);
          console.log("INFO: update onlineBIG: " + onlineBIG + " onlineMID: " + onlineMID + " onlineLIL: " + onlineLIL);
        });
      });
    } else if (statsName == 'infExpired'){
      db.get_stats(settings.coin, function(stats){
        var deamonH  = stats.count;
        var next1d   = deamonH + 1*720;
        var next7d   = deamonH + 7*720;
        var next14d  = deamonH + 14*720;
        var next30d  = deamonH + 30*720;
        var next60d  = deamonH + 60*720;
        var next90d  = deamonH + 90*720;
        var next120d = deamonH + 120*720;
        var next150d = deamonH + 150*720
        var next180d = deamonH + 180*720;
        var next270d = deamonH + 270*720;
        const cursor = Inf.aggregate([
                                      {$group: {
                                       "_id" : {
                                         $concat: [
                                           { $cond: [{$lt: ["$expired_height",deamonH]}, "A", ""]},
                                           { $cond: [{$and:[ {$gte:["$expired_height", deamonH ]}, {$lt: ["$expired_height", next1d ]}]}, "E-1", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next1d ]}, {$lt: ["$expired_height", next7d ]}]}, "E-7", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next7d ]}, {$lt: ["$expired_height", next14d ]}]}, "E-14", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next14d ]}, {$lt: ["$expired_height", next30d ]}]}, "E-30", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next30d ]}, {$lt: ["$expired_height", next60d ]}]}, "E-60", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next60d ]}, {$lt: ["$expired_height", next90d ]}]}, "E-90", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next90d ]}, {$lt: ["$expired_height", next120d ]}]}, "E-120", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next120d ]}, {$lt: ["$expired_height", next150d ]}]}, "E-150", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next150d ]}, {$lt: ["$expired_height", next180d ]}]}, "E-180", ""] },
                                           { $cond: [{$and:[ {$gte:["$expired_height", next180d ]}, {$lt: ["$expired_height", next270d ]}]}, "E-270", ""] },
                                           { $cond: [{$gte:["$expired_height", next270d ]}, "H", ""]}
                                         ]
                                       },
                                       count: { $sum: 1 }
                                     }},
                                     {$sort : { _id : 1} }
                                  ]).cursor({ batchSize: 1000}).exec();
        const data = [];
        const result = async function () {
          var doc;
          var inf_exp = 0; inf_exp_1d = 0;
          var inf_exp_7d = 0; inf_exp_14d = 0;
          var inf_exp_30d = 0; inf_exp_60d = 0;
          var inf_exp_90d = 0; inf_exp_120d = 0;
          var inf_exp_150d = 0; inf_exp_180d = 0;
          var inf_exp_270d = 0; inf_exp_365d = 0;
          while ((doc = await cursor.next())) {
            if (doc) {
              var item = {range: doc['_id'], count: doc['count']};
              data.push(item);
              if (doc['_id'] == "A")       {inf_exp=doc['count'];}
              if (doc['_id'] == "E-1")     {inf_exp_1d=doc['count'];}
              if (doc['_id'] == "E-7")     {inf_exp_7d=doc['count'];}
              if (doc['_id'] == "E-14")    {inf_exp_14d=doc['count'];}
              if (doc['_id'] == "E-30")    {inf_exp_30d=doc['count'];}
              if (doc['_id'] == "E-60")    {inf_exp_60d=doc['count'];}
              if (doc['_id'] == "E-90")    {inf_exp_90d=doc['count'];}
              if (doc['_id'] == "E-120")   {inf_exp_120d=doc['count'];}
              if (doc['_id'] == "E-150")   {inf_exp_150d=doc['count'];}
              if (doc['_id'] == "E-180")   {inf_exp_180d=doc['count'];}
              if (doc['_id'] == "E-270")   {inf_exp_270d=doc['count'];}
              if (doc['_id'] == "H")       {inf_exp_365d=doc['count'];}
              console.log("Range: " + doc['_id'] + " " + doc['count']);
            }
          }

          Stats.updateOne({coin: settings.coin}, {
            inf_exp: inf_exp, inf_exp_1d: inf_exp_1d,
            inf_exp_7d: inf_exp_7d, inf_exp_14d: inf_exp_14d,
            inf_exp_30d: inf_exp_30d, inf_exp_60d: inf_exp_60d,
            inf_exp_90d: inf_exp_90d, inf_exp_120d: inf_exp_120d,
            inf_exp_150d: inf_exp_150d, inf_exp_180d: inf_exp_180d,
            inf_exp_270d: inf_exp_270d, inf_exp_365d: inf_exp_365d
          }, function() {exit();});
          console.log("INFO: updated node expired stats");
        };
        result();
      });
    } else if (statsName == 'tx7days'){
      db.get_stats(settings.coin, function(stats){
        var deepth7 = stats.last - 7*720;
        var deepth6 = stats.last - 6*720;
        var deepth5 = stats.last - 5*720;
        var deepth4 = stats.last - 4*720;
        var deepth3 = stats.last - 3*720;
        var deepth2 = stats.last - 2*720;
        var deepth1 = stats.last - 1*720;
        var blockH = stats.last;
        const cursor = Tx.aggregate([
                                     {$match: {
                                       $and: [
                                         {blockindex: {$gt: deepth7}},
                                         {vin: {$elemMatch: {addresses : {$ne: "coinbase"}}}}
                                       ]
                                     }},
                                     {$group: {
                                       "_id" : {
                                         $concat: [
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth7 ]}, {$lt: ["$blockindex", deepth6]}]}, "H-6", ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth6 ]}, {$lt: ["$blockindex", deepth5]}]}, "H-5", ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth5 ]}, {$lt: ["$blockindex", deepth4]}]}, "H-4", ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth4 ]}, {$lt: ["$blockindex", deepth3]}]}, "H-3", ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth3 ]}, {$lt: ["$blockindex", deepth2]}]}, "H-2", ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth2 ]}, {$lt: ["$blockindex", deepth1]}]}, "H-1", ""] },
                                           { $cond: [{$gte:["$blockindex",deepth1]}, "H", ""]}
                                         ]
                                       },
                                       count: { $sum: 1 },
                                       total: { $sum: "$total" }
                                     }},
                                     {$sort : { _id : 1} }
                                  ]).cursor({ batchSize: 1000}).exec();
        const data = [];
        const result = async function () {
          var doc;
          var tx_d0_count = 0; tx_d0_value = 0;
          var tx_d1_count = 0; tx_d1_value = 0;
          var tx_d2_count = 0; tx_d2_value = 0;
          var tx_d3_count = 0; tx_d3_value = 0;
          var tx_d4_count = 0; tx_d4_value = 0;
          var tx_d5_count = 0; tx_d5_value = 0;
          var tx_d6_count = 0; tx_d6_value = 0;
          while ((doc = await cursor.next())) {
            if (doc) {
              var item = {range: doc['_id'], count: doc['count'], total: doc['total']};
              data.push(item);
              if (doc['_id'] == "H")   {tx_d0_count=doc['count']; tx_d0_value=doc['total']/100000000;}
              if (doc['_id'] == "H-1") {tx_d1_count=doc['count']; tx_d1_value=doc['total']/100000000;}
              if (doc['_id'] == "H-2") {tx_d2_count=doc['count']; tx_d2_value=doc['total']/100000000;}
              if (doc['_id'] == "H-3") {tx_d3_count=doc['count']; tx_d3_value=doc['total']/100000000;}
              if (doc['_id'] == "H-4") {tx_d4_count=doc['count']; tx_d4_value=doc['total']/100000000;}
              if (doc['_id'] == "H-5") {tx_d5_count=doc['count']; tx_d5_value=doc['total']/100000000;}
              if (doc['_id'] == "H-6") {tx_d6_count=doc['count']; tx_d6_value=doc['total']/100000000;}
              console.log("Range: " + doc['_id'] + " " + doc['count'] + " " + doc['total']);
            }
          }
          Stats.updateOne({coin: settings.coin}, {
            tx_d0_count: tx_d0_count, tx_d0_value: tx_d0_value,
            tx_d1_count: tx_d1_count, tx_d1_value: tx_d1_value,
            tx_d2_count: tx_d2_count, tx_d2_value: tx_d2_value,
            tx_d3_count: tx_d3_count, tx_d3_value: tx_d3_value,
            tx_d4_count: tx_d4_count, tx_d4_value: tx_d4_value,
            tx_d5_count: tx_d5_count, tx_d5_value: tx_d5_value,
            tx_d6_count: tx_d6_count, tx_d6_value: tx_d6_value
          }, function() {exit();});
          console.log("INFO: updated 7 days transaction statst");
        };
        result();
      });
    } else {
      exit();
    }
    //END
  }
});

