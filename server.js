const express = require('express')
const app = express()
const configFile = require('./configFile.json')
const moment = require('moment');

const fs = require('fs');
const request = require('request');
const parse = require('csv-parse');
const bodyParser = require('body-parser');
const stockRsi = require('technicalindicators').RSI;
const AWS = require('aws-sdk');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const models = [
    {"type":"1 day adjusted","model":"ml-KnXusMIYTRZ"},
    {"type":"1 day control","model":"ml-v2BGXmOj7z3"}
];
AWS.config.update(configFile.awsKeys);

AWS.config.update({region:'us-east-1'});
const ml = new AWS.MachineLearning({ signatureVersion: 'v4' });


let csvData=[];
let priceData=[];
let count = 0;
let csvAllRows = [];
let csvRowsCopySimulation = [];
let stockRSIValues = [];
let intialRun = true;
let firstRunData = {};
let isBuy = true;
let totalPredictions = [];
let mlPredictCounter = 0;
let buyData = [];
let buyDataAndDateOnly = [];
let buyDataMap = {};
let backTestData = [];
let backTestCorrect = 0;
let backTestNonCorrect = 0;
let buyCorrectCounter = 0;
let sellCorrectCounter = 0;
let testPortfolio = 10000;
let csvDataMap = {};
let lastActiveTrade = "-1";
let addPointsToBuyData = false;

function parseBuyAndSellData(res) {
    buyData = [];
    buyDataAndDateOnly = [];
    count = 0;
    fs.createReadStream("./buyData4.csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {
        buyData.push(csvrow);
        let timeStamp = moment(csvrow[0]).utc().unix();
        if (count > 0) {
            buyDataAndDateOnly.push({"originalTime": csvrow[0], "timeStamp":timeStamp * 1000,"action":csvrow[1]});

            if (csvrow[1] == "1" || csvrow[1] == "-1") {
                buyDataMap[timeStamp] = csvrow[1];
            }
        }
        count++;
    }).on('end',function() {
        parseData(res);
    });
}

function parseData(res) {
    count = 0;
    fs.createReadStream("./test.csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {
        
        if (intialRun) {
            csvAllRows.push(csvrow);
        }
        let timeStamp = moment(csvrow[0]).utc().unix();
        let formattedTimeStamp = moment(parseInt(timeStamp.toString()+"000")).format("M/D/Y");
        let csvObj = [timeStamp*1000,parseFloat(csvrow[4]),count,formattedTimeStamp];
        if (count > 0) {
            csvDataMap[formattedTimeStamp] = csvrow;
            csvData.push(csvObj);       
            priceData.push(parseFloat(csvrow[4]));
        }
        count++;
    })
    .on('end',function() {
    
        console.log("done");

        stockRSIValues = [];
        console.log(priceData.length);
        let stockRsiResult = stockRsi.calculate({
            period: 14,
            values:priceData});
            priceData=[];

        let sendRsiData = [];
       let z = 0;
    
       console.log(stockRsiResult.length);
      
       for (;z < stockRsiResult.length ; z++) {       
        if (z > 13) {
            let last14 = stockRsiResult.slice(z-14,z);
      
            let max = Math.max.apply(null, last14);
            let min = Math.min.apply(null, last14);
            let stochRSI = (last14[last14.length-1] - min) / (max - min);
            stockRSIValues.push(stochRSI.toFixed(2));
            let roundNumber = Math.round(stochRSI * 10) / 10;
            sendRsiData.push([csvData[z+14][0],roundNumber]);
        }
       
      }

      intialRun = false;
      firstRunData = {csvData:csvData,rsiData:sendRsiData,buyDataAndDateOnly:buyDataAndDateOnly};
      res.send(firstRunData);
    });
}

function downloadCsv(response) {
    console.log("download csv");
    let dest = "./test.csv";
    request.get({
        headers: {
          'Cookie': 'B=b9ihaitdim360&b=3&s=8m'
        },
        uri: 'http://query1.finance.yahoo.com/v7/finance/download/SPY?period1=946699258&period2=9929548208&interval=1d&events=history&crumb=HbK4LWmmHjG',
        method: 'GET'
      }, function(err, res, body) {     
        console.log(err);
        console.log(dest);
        fs.writeFile(dest, body, function(err) {
            if(err) {
                return console.log(err);
            }
            //console.log(res);
            console.log("The file was saved!");
            parseBuyAndSellData(response);
        }); 
    });
}

function addData(data,res) {
    let i =0;
    let dataRow = [];
    let isBuyBeforeChange = isBuy;
    let adjustedClose = [];
    let thereWasABuyOrSell = false;
    let addedBuy = "0";
    let reSaveTimestamp;

    for (; i < csvAllRows.length; i++) {

        // seed initial columns
        if (i === 0) {
            // Buy
            csvAllRows[i][7] = "Gains";
            csvAllRows[i][8] = "Multi Day Gains";
            csvAllRows[i][9] = "SMA Gains";
            csvAllRows[i][10] = "Stoch RSI";
            csvAllRows[i][11] = "Single Day Volume";
            csvAllRows[i][12] = "Buy";
            csvAllRows[i][13] = "Stoch Avg";
            csvAllRows[i][14] = "SMA Gains Avg";
            csvAllRows[i][15] = "Buys Avg";

            continue;
        }

        if (csvAllRows[i][0] === data.time) {
            console.log("isBuy:" + isBuy);
             // late so need to rework
            if (addPointsToBuyData) {
                if (isBuy) {
                    csvAllRows[i-1][12] = 1;
                    isBuy = false;
                } else {
                    csvAllRows[i-1][12] = -1;
                    isBuy = true;
                }
            
                reSaveTimestamp = moment(csvAllRows[i][0]).utc().unix();
                buyDataMap[reSaveTimestamp] = !isBuy ? "1" : "-1";
                addedBuy = !isBuy ? "1" : "-1";
                thereWasABuyOrSell = true;    
            }
            dataRow = csvAllRows[i];
        } else {
            thereWasABuyOrSell = false;
            csvAllRows[i][7] = "";
            csvAllRows[i][8] = "";
            csvAllRows[i][9] = "";
            csvAllRows[i][10] = "";
            csvAllRows[i][11] = "";
            csvAllRows[i][12] = "0";
            csvAllRows[i][13] = "";
            csvAllRows[i][14] = "";
            csvAllRows[i][15] = "";
        }

        let timestamp = 0;
        if (csvAllRows[i+1]) {
            timestamp = moment(csvAllRows[i+1][0]).utc().unix();
        }
        let buyAction = buyDataMap[timestamp];
        if (buyAction && !thereWasABuyOrSell) {
            csvAllRows[i][12] = buyAction;
        }

        let calcMovingAverage = [];
        if (i > 1) {
            let singleDayVolume = ((csvAllRows[i][6] - csvAllRows[i-1][6]) / csvAllRows[i-1][6]);
            let singleDayGains = ((csvAllRows[i][5] - csvAllRows[i-1][5]) / csvAllRows[i-1][5]);
            csvAllRows[i][7] = singleDayGains.toFixed(2); 
            csvAllRows[i][11] = singleDayVolume.toFixed(2)
            if (i > 2) {
                let multiDayGains = ((csvAllRows[i][5] - csvAllRows[i-2][5]) / csvAllRows[i-2][5]);
                csvAllRows[i][8] = multiDayGains.toFixed(2);
                if (i > 3) {
                    let smaGains = ((parseFloat(csvAllRows[i][7]) + parseFloat(csvAllRows[i-1][7]) +  parseFloat(csvAllRows[i-2][7])) / 3);
                    csvAllRows[i][9] = smaGains.toFixed(2);
                }
    
            }
        }

        if (i > 28 && stockRSIValues[i-29]) {
            let roundNumber = Math.round(stockRSIValues[i-29] * 10) / 10;
            csvAllRows[i][10] = parseFloat(roundNumber);

            let smaGainAverage = 0;
            let stochRsiAverage = 0;
            let buyAverage = 0;
            let smaTotal = 0;
            let stochRsiTotal = 0;
            let buyTotal = 0;
            let z = 0;
            let stochAverage = [];
            for (;z < 6; z++) {
                smaTotal += parseFloat(csvAllRows[i-z][9]);
                stochAverage.push(parseFloat(csvAllRows[i-z][10]));
                stochRsiTotal += parseFloat(csvAllRows[i-z][10]);
                buyTotal += parseFloat(csvAllRows[i-z][12]);
            }
            //console.log(stochAverage);
            smaGainAverage = smaTotal / 6;
            stochRsiAverage = stochRsiTotal / 6;
            buyAverage = buyTotal / 6;

            let smaGains = ((parseFloat(csvAllRows[i][7]) + parseFloat(csvAllRows[i-1][7]) +  parseFloat(csvAllRows[i-2][7])) / 3);
            csvAllRows[i][9] = smaGains.toFixed(2);

            csvAllRows[i][13] = stochRsiAverage.toFixed(2);
            csvAllRows[i][14] = smaGainAverage.toFixed(2);
            csvAllRows[i][15] = buyAverage.toFixed(3);

        }
    }
   let convertedRows = "";
   let x = 0;
   for (; x < csvAllRows.length; x++) {

    convertedRows += csvAllRows[x][0] + "," +  csvAllRows[x][7] + "," + csvAllRows[x][8] + "," + csvAllRows[x][9] +
     "," + csvAllRows[x][10] + "," + csvAllRows[x][11] + "," + csvAllRows[x][12] + "," + csvAllRows[x][13] + "," + csvAllRows[x][14] + "," + csvAllRows[x][15] +"\n";
   }

   // Write Buy Data
   let buyDataCsvOut = "";
   if (addPointsToBuyData) {
        let z = 0;
        let action = "0";
        for (; z < csvData.length;z++) {
            if (reSaveTimestamp == csvData[z][0]/1000) {
                action = !isBuy ? "1" : "-1";
                //buyDataAndDateOnly[z] = {"originalTime": moment(csvData[z][0]).format("M/D/Y"), "timeStamp":reSaveTimestamp,"action":action}
            } else {
                if (buyDataMap[csvData[z][0]/1000]) {
                    action = buyDataMap[csvData[z][0]/1000];
                } else {
                    action = "0";
                }
            }
            buyDataCsvOut += moment(csvData[z][0]).format("M/D/Y") + "," +  action +"\n";
        }
    }

   let lastRow = csvAllRows[csvAllRows.length - 1]; 
   
   let p = new Promise(function(resolve, reject) {
       mlPredictCounter = 0;
       totalPredictions = [];
       mlPredict(resolve,dataRow,false,false);
   });

    p.then(function(data){
       if (convertedRows.length > 0) {
            fs.writeFile('public/testout.csv', convertedRows, 'utf8', function (err) {
                if (err) {
                    console.log(err);
                    console.log('Some error occured - file either not saved or corrupted file saved.');
                    res.send({msg:"error","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow});
                } else{
                    let responseMessage = {msg:"saved","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow};
                    if (addPointsToBuyData) {
                        console.log("writing data to buyData4.csv " + addPointsToBuyData);
                        fs.writeFile('./buyData4.csv', buyDataCsvOut, 'utf8', function (err) {
                            console.log('It\'s saved!');
                            res.send(responseMessage);
                        });
                    } else {
                        res.send(responseMessage);
                    }
                }
            });
        } else {
            res.send({msg:"error","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow});
        }
    });
}

function portfolioSimulation(res) {
    let test = true;
    if (test) {
        csvRowsCopySimulation = csvAllRows.slice(4000,4400);
    } else {
        csvRowsCopySimulation = csvAllRows.slice(15,csvAllRows.length - 1);
    }
    let p = new Promise(function(resolve, reject) {
        mlPredictCounter = 0;
        totalPredictions = [];
        mlPredict(resolve,null,false,true);
    });
    p.then(function(){
        console.log("testPortfolio " + testPortfolio);
        res.send({"status":"success"});
    });
}

function checkBuySellData(res) {
    let z = 0;
    let portfolio = 10000;
    let amountBought;
    let lastPortfolioValue;
    let lastTrade;
    for (; z < csvAllRows.length; z++) {

        let y = z;
        //console.log(csvAllRows[z][12]);
        if (csvAllRows[z][12] == "1") {
           
            if (lastTrade == "buy") {
                console.log("last buy error " + csvAllRows[z + 1][0]);
            } 
            lastTrade = "buy";
            amountBought = (50 * parseFloat(csvAllRows[z + 1][4]));
            //console.log("buy " + amountBought + " " + csvAllRows[z + 1][0]);
            lastPortfolioValue = portfolio;
            portfolio = portfolio - amountBought;
        } else if (csvAllRows[z][12] == "-1") {
            if (lastTrade == "sell") {
                console.log("last sell error " + csvAllRows[z + 1][0]);
            } 
            lastTrade = "sell";
            amountSold =  (50 * parseFloat(csvAllRows[z + 1][4]));
            //console.log("sell " + amountSold + " " + csvAllRows[z + 1][0]);
            if (amountSold < amountBought) {
                console.log("*** lost money " + csvAllRows[z + 1][0]);
            }
            portfolio = portfolio + amountSold;
        }
    }    
    console.log(portfolio);
    res.send({"status":"success"});
}

function backTest(res) {
    let u = 0;
    let testMode = false;
    backTestCorrect = 0;
    backTestNonCorrect = 0;
    buyCorrectCounter = 0;
    sellCorrectCounter = 0;
    testPortfolio = 0;
    
    let testCount = 0;
    backTestData = [];
    for (; u < buyData.length;u++) {
        if (buyData[u][6] == "-1" || buyData[u][6] == "1") {
            if (testMode && backTestData.length > 100) {
                break;
            }
            testCount++;
            let predictAccuracyObj = {decision:0,dataOneDayBackData:{},dataCurrentData:{},mlPredict:{},correct:null};
            predictAccuracyObj.decision = buyData[u][6];
            predictAccuracyObj.dataOneDayBackData = buyData[u -1];
            predictAccuracyObj.dataCurrentData = buyData[u];
            backTestData.push(predictAccuracyObj);
        }
    }
    console.log("total test rows " + testCount);
    console.log("starting model verification");

    let p = new Promise(function(resolve, reject) {
        mlPredictCounter = 0;
        mlPredict(resolve,null,true,false);
    });
    p.then(function(){
        console.log("total record count " + testCount);
        console.log("backTest Correct " + backTestCorrect);
        console.log("backTest False " + backTestNonCorrect);
        console.log("percentage correct " + backTestCorrect/backTestData.length);
        console.log("percentage notcorrect " + backTestNonCorrect/backTestData.length);
        console.log("buy correct " + buyCorrectCounter);
        console.log("sell correct " + sellCorrectCounter);
        console.log("correct buy percentage " + buyCorrectCounter/backTestCorrect);
        console.log("correct sell percentage " + sellCorrectCounter/backTestCorrect);
        console.log("testPortfolio " + testPortfolio);
        res.send({"status":"success"});
    });
}

function mlPredict(resolve,lastRow,backTest,activeTrade) {
    if (
        !backTest && mlPredictCounter < models.length || 
        backTest && mlPredictCounter < backTestData.length ||
        activeTrade && mlPredictCounter < csvRowsCopySimulation.length - 1
    ) {

        let activeModel;
        let gains;
        let multiDayGains;
        let smaGains;
        let stochRsi;
        let volume;
        let stochAverage;
        let smaGainAverage;
        let buysAverage;

      
        if (activeTrade) {
            lastRow = csvRowsCopySimulation[mlPredictCounter];
        }

        if (backTest) {
            activeModel = models[0];
            lastRow = backTestData[mlPredictCounter].dataOneDayBackData;
            gains = lastRow[1].toString();
            multiDayGains = lastRow[2].toString();
            smaGains = lastRow[3].toString();
            stochRsi = lastRow[4].toString();
            volume = lastRow[5].toString();
            stochAverage = lastRow[7].toString();
            smaGainAverage = lastRow[8].toString();
            buysAverage = lastRow[9].toString();
        } else {
            gains = lastRow[7].toString();
            multiDayGains = lastRow[8].toString();
            smaGains = lastRow[9].toString();
            stochRsi = lastRow[10].toString();
            volume = lastRow[11].toString();
            stochAverage = lastRow[13].toString();
            smaGainAverage = lastRow[14].toString();
            buysAverage = lastRow[15].toString();
            activeModel = models[mlPredictCounter];
            if (activeTrade) {
                activeModel = models[0];
            }
        }

      

        let params = {
            MLModelId: activeModel.model, 
            PredictEndpoint: 'https://realtime.machinelearning.us-east-1.amazonaws.com',
            Record: {
                "Gains": gains,
                "Multi Day Gains": multiDayGains,
                "SMA Gains": smaGains,
                "Stoch RSI": stochRsi,
                "Single Day Volume": volume,
                "Stoch Avg": stochAverage,
                "SMA Gains Avg": smaGainAverage,
                "Buys Avg": buysAverage
            }
        };

        //console.log(params);

        ml.predict(params, function(err, data) {
            if (err) {
                console.log(err, err.stack);
            } else {     
                //console.log(data);
                let obj = {};

        
                obj.buy = data["Prediction"]["predictedScores"][1].toFixed(2);
                if (data["Prediction"]["predictedScores"][-1]) {
                    obj.sell = data["Prediction"]["predictedScores"][-1].toFixed(2);
                }
                obj.hold = data["Prediction"]["predictedScores"][0].toFixed(2);
                obj.type = activeModel.type;
                totalPredictions.push(obj);
                let mlBuy;
                if (backTest) {
                    mlBuy = parseFloat(obj.buy) > parseFloat(obj.sell);
                    if (mlBuy && backTestData[mlPredictCounter].decision == "1") {
                        backTestData[mlPredictCounter].correct = true;
                        backTestCorrect++;
                        buyCorrectCounter++;

                    } else if (!mlBuy && backTestData[mlPredictCounter].decision == "-1") {

                        backTestData[mlPredictCounter].correct = true;
                        backTestCorrect++;
                        sellCorrectCounter++;
                    } else {
                        backTestNonCorrect++;
                        backTestData[mlPredictCounter].correct = false;
                    }

                }

                if (activeTrade) {
                    let priceData = csvRowsCopySimulation[mlPredictCounter + 1];
                    mlBuy = parseFloat(obj.buy) > parseFloat(obj.sell);
                    let totalValuePurchased = parseFloat(priceData[4] * 70);
                    if (mlBuy && lastActiveTrade == "-1") {
                        lastActiveTrade = "1";
                        testPortfolio = testPortfolio - totalValuePurchased;
                        console.log("buy: " + testPortfolio + " time " + priceData[0] + " total bought " + totalValuePurchased);
                    } else if (!mlBuy && lastActiveTrade == "1") {
                        lastActiveTrade = "-1";
                        testPortfolio = testPortfolio + totalValuePurchased;
                        console.log("sell: " + testPortfolio  + " time " + priceData[0]  + " total bought " + totalValuePurchased);
                    }
                }

                mlPredictCounter++;

                mlPredict(resolve,lastRow,backTest,activeTrade);
            }
        });
    } else {
        resolve();
    }
}

app.get('/:editing', function(req, res) {
    csvData=[];
    priceData=[];
    count = 0;
    csvAllRows = [];
    stockRSIValues = [];
    intialRun = true;
    firstRunData = {};
    console.log("start");
    if (req.param("editing") != "true") {
        addPointsToBuyData = false;
    }  else {
        addPointsToBuyData = true;
    }
    console.log("Editing " + addPointsToBuyData);
    downloadCsv(res);
});
app.post('/save', function(req, res) {
    addData(req.body,res);
});

app.get('/backTest', function(req, res) {
    backTest(res);
});

app.get('/simulate', function(req, res) {
    portfolioSimulation(res);
});

app.get('/checkBuySellData', function(req, res) {
    checkBuySellData(res);
});


app.listen(8080, () => console.log('Example app listening on port 8080!'))
