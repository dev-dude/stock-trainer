const express = require('express')
const app = express()
const configFile = require('./configFile.json')
const moment = require('moment');


const fs = require('fs');
const request = require('request');
const parse = require('csv-parse');
const bodyParser = require('body-parser');
const stockRsi = require('technicalindicators').RSI;
const EMA = require('technicalindicators').EMA;
const OBV = require('technicalindicators').OBV; 
const AWS = require('aws-sdk');
const basicAuth = require('basic-auth-connect');

const compression = require('compression');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(basicAuth('stock', 'chart'));
app.use(compression());

const models = [
    {"type":"local","model":"local"},
    {"type":"buyssells","model":"ml-M9qXSuIXTL1"},
    {"type":"buyssells","model":"ml-cb5e1PNTZVI"},
    {"type":"buyssells","model":"ml-Q3gtDAgBPMu"},
    {"type":"dumb-test-model","model":"ml-F0p499IfShN"},   
    {"type":"bond3","model":"ml-nrqCxllWh58"},
    {"type":"bond2","model":"ml-QdqmZhvuMaI"}
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
let backTestBuyNonCorrect = 0;
let backTestSellNonCorrect = 0;
let testPortfolio = 10000;
let csvDataMap = {};
let lastActiveTrade = "-1";
let addPointsToBuyData = false;
let desiredBackTestModel = 0;
let shortPrice = 0;
let sharesPurchased;
let startSimulation = true;
let secondModelEnabled = false;
let simulationLog = "<ul>";
let simulationLogCsv = "type,shares,test portfolio,time,total amount bought,share price\n";
let tickerStartTime = 1176235388;
let tickerEndTime = 15341894997;

let columnHeaders =   ["Gains","Multi Day Gains","SMA Gains","Stoch RSI", "Single Day Volume","Buy","Stoch Avg","SMA Gains Avg","Buys Avg","Expon Moving Avg","Triple Expon Smoothed","Bond Gains","Bond Vol","Bond Expon Avg","Bond Triple","Trs Gains","Trs Vol","Trs Expon Avg","Trs Triple","EUR Gains","EUR Vol","EUR Expon Avg","EUR Triple"];
let exportColumnHeaders =   {"Gains":true,"Multi Day Gains":true,"Stoch RSI":true, "Single Day Volume":true,"Buy":true,"Expon Moving Avg":true,"Triple Expon Smoothed":true,"Bond Vol":true,"Bond Triple":true,"Trs Vol":true,"Trs Expon Avg":true,"Trs Triple":true,"EUR Gains":true,"EUR Vol":true,"EUR Expon Avg":true,"EUR Triple":true};
let symbols = [];
let activeSymbols = [
    {
        "label":"BND",
        "singleDayVolume":{"val":0,"index":19},
        "singleDayGains":{"val":0,"index":18}
    },
    { 
        "label":"UUP",
        "singleDayVolume":{"val":0,"index":23},
        "singleDayGains":{"val":0,"index":22}
    },
    {
        "label":"XLF",
        "singleDayVolume":{"val":0,"index":27},
        "singleDayGains":{"val":0,"index":26}
    }
];

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
        console.log("buy Data parsed");
        parseData(res);
    });
}

let headerMap;
let customRows;
let customCount = 0;
function parseCustom(resolve) {
   customCount = 0;
   customRows = [];
   fs.createReadStream("./custom.csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {
        if (customCount  == 0) {
             headerMap = csvrow; 
        } else {
            customRows.push(csvrow);
	}
       customCount++;
    })
    .on('end',function() {
      resolve();
    });
} 

function intializeSymbols(indexSize) {
    let i = 0;
    for(; i < indexSize;i++) {
        symbols[i] = {
            secondSymbolCsvDataMap:{},
            secondSymbolCsvData:[],
            secondSymbolPriceData:[],
            secondSymbolAllRows:[]
        }

    }
}

function parseDataPromise(resolve,symbol,index) {
   count = 0;
   fs.createReadStream("./"+symbol+".csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {

        if (intialRun) {
            symbols[index].secondSymbolAllRows.push(csvrow);
        }
        let timeStamp = moment(csvrow[0]).utc().unix();
        let formattedTimeStamp = moment(parseInt(timeStamp.toString()+"000")).format("M/D/Y");
        let csvObj = [timeStamp*1000,parseFloat(csvrow[4]),count,formattedTimeStamp];
        if (count > 0) {
            symbols[index].secondSymbolCsvDataMap[formattedTimeStamp] = csvrow;
            symbols[index].secondSymbolCsvData.push(csvObj);
            symbols[index].secondSymbolPriceData.push(parseFloat(csvrow[4]));
        }
        count++;
    })
    .on('end',function() {  
         resolve();
    });
}

function parseData(res) {
    count = 0;
    fs.createReadStream("./SPY.csv")
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
            stockRSIValues.push(stochRSI.toFixed(3));
            let roundNumber = Math.round(stochRSI * 10) / 10;
            sendRsiData.push([csvData[z+14][0],roundNumber]);
        }
       
      }

       //Load custom data
       //FIXME: New Symbol HERE
        let p = new Promise(function(resolve, reject) {
           parseDataPromise(resolve,"BND",0);
        });  
        let p2 = new Promise(function(resolve, reject) {
            parseDataPromise(resolve,"UUP",1);
         });
         let p3 = new Promise(function(resolve, reject) {
            parseDataPromise(resolve,"XLF",2);
         });
        Promise.all([p,p2,p3]).then(function() {
            intialRun = false;
            //FIXME: New Symbol HERE
            firstRunData = {csvData:csvData,rsiData:sendRsiData,
                buyDataAndDateOnly:buyDataAndDateOnly,
                secondSymbolCsvData:symbols[0].secondSymbolCsvData,
                thirdSymbolCsvData:symbols[1].secondSymbolCsvData,
                fourthSymbolCsvData:symbols[2].secondSymbolCsvData};
	    res.send(firstRunData);
        });
    });
}

function downloadCsv(response,type) {
    intializeSymbols(activeSymbols.length);
    console.log("download csv");
    let dest = "./"+type+".csv";
    request.get({
        headers: {
          'Cookie': 'B=b9ihaitdim360&b=3&s=8m'
        },
        uri: 'http://query1.finance.yahoo.com/v7/finance/download/'+type+'?period1='+tickerStartTime+'&period2='+tickerEndTime+'&interval=1d&events=history&crumb=HbK4LWmmHjG',
        method: 'GET'
      }, function(err, res, body) {     
        console.log(err);
        console.log(dest);
        fs.writeFile(dest, body, function(err) {
            if(err) {
                return console.log(err);
            }
            //console.log(res);
            //FIXME: New Symbol HERE
            console.log("The file was saved!");
              if (type == "SPY") {
                console.log("parsing BND");
                downloadCsv(response,"BND");
              } else if (type == "BND") {
                console.log("parsing UUP");
                downloadCsv(response,"UUP");
            } else if (type == "UUP") {
                console.log("parsing XLF");
                downloadCsv(response,"XLF");
              } else {
                console.log("processing data");
 		        parseBuyAndSellData(response);
	         } 
        }); 
    });
}

function addData(data,res) {
    let i =0;
    let dataRow = [];
    let isBuyBeforeChange = isBuy;
    let thereWasABuyOrSell = false;
    let reSaveTimestamp;

    for (; i < csvAllRows.length; i++) {

        // seed initial columns
        if (i === 0) {

            // Initialize all CSV headers
            let initalCount = 7;
            columnHeaders.forEach(function(header){
                csvAllRows[i][initalCount] = header;
                initalCount++;
            });
            continue;
        }

        if (csvAllRows[i][0] === data.time) {
            console.log("isBuy:" + isBuy);
             // late so need to rework
             reSaveTimestamp = moment(csvAllRows[i][0]).utc().unix();
            if (addPointsToBuyData) {
                if (isBuy) {
                    csvAllRows[i-1][12] = 1;
                    isBuy = false;
                } else {
                    csvAllRows[i-1][12] = -1;
                    isBuy = true;
                }
            
                buyDataMap[reSaveTimestamp] = !isBuy ? "1" : "-1";
                addedBuy = !isBuy ? "1" : "-1";
                thereWasABuyOrSell = true;    
                csvAllRows[i][12] = csvAllRows[i][12] ?  csvAllRows[i][12] : "0";
            } else {
                if (!buyDataMap[reSaveTimestamp]) {
                    csvAllRows[i][12] = "0"
                } else {
                    csvAllRows[i][12] = buyDataMap[reSaveTimestamp];
                }
            }
            dataRow = csvAllRows[i];
        } else {
            thereWasABuyOrSell = false;

            // zero or blank out all row values
            let blankColumns = 7;
            columnHeaders.forEach(function(header){
                if (blankColumns == 12) {
                    csvAllRows[i][blankColumns] = "0";
                } else {
                    csvAllRows[i][blankColumns] = "";
                }
                blankColumns++;
            });
        }

        let timestamp = 0;
        if (addPointsToBuyData && csvAllRows[i+1]) {
            timestamp = moment(csvAllRows[i+1][0]).utc().unix();
        } else if (csvAllRows[i+1]){
            timestamp = moment(csvAllRows[i+1][0]).utc().unix();
        }

        let buyAction = buyDataMap[timestamp];
        if (buyAction && !thereWasABuyOrSell) {
             csvAllRows[i][12] = buyAction;
        }

        if (i > 1) {
            let singleDayVolume = ((csvAllRows[i][6] - csvAllRows[i-1][6]) / csvAllRows[i-1][6]);
            let singleDayGains = ((csvAllRows[i][5] - csvAllRows[i-1][5]) / csvAllRows[i-1][5]);

            // dynamically allocate more symbols
            let y = 0;
            for(; y < symbols.length;y++) {
                activeSymbols[y].singleDayVolume.val = ((symbols[y].secondSymbolAllRows[i][6] - symbols[y].secondSymbolAllRows[i-1][6]) / symbols[y].secondSymbolAllRows[i-1][6]);
                activeSymbols[y].singleDayGains.val = ((symbols[y].secondSymbolAllRows[i][5] - symbols[y].secondSymbolAllRows[i-1][5]) / symbols[y].secondSymbolAllRows[i-1][5]);
                csvAllRows[i][activeSymbols[y].singleDayGains.index] = activeSymbols[y].singleDayGains.val.toFixed(3);
                csvAllRows[i][activeSymbols[y].singleDayVolume.index] = activeSymbols[y].singleDayVolume.val.toFixed(3);
            }
  	    
	        csvAllRows[i][7] = singleDayGains.toFixed(3); 
            // Set buy and sell
	        csvAllRows[i][11] = singleDayVolume.toFixed(3);

            if (i > 2) {
                let multiDayGains = ((csvAllRows[i][5] - csvAllRows[i-2][5]) / csvAllRows[i-2][5]);
                csvAllRows[i][8] = multiDayGains.toFixed(3);
                if (i > 3) {
                    let smaGains = ((parseFloat(csvAllRows[i][7]) + parseFloat(csvAllRows[i-1][7]) +  parseFloat(csvAllRows[i-2][7])) / 3);
                    csvAllRows[i][9] = smaGains.toFixed(3);
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
            csvAllRows[i][9] = smaGains.toFixed(3);

            csvAllRows[i][13] = stochRsiAverage.toFixed(3);
            csvAllRows[i][14] = smaGainAverage.toFixed(3);
            csvAllRows[i][15] = buyAverage.toFixed(3)
        }
    }

    // Exponential Moving average and other post processing 
    let z = 0;
    let gainsOnly = [];
    let gainsAndDate = {};
    let obv = {close:[],volume:[]};
    let obvBond = {close:[],volume:[]};
    let obvTrs = {close:[],volume:[]};
    let obvEur = {close:[],volume:[]};
    let obvTrsGains = [];
    let bondGains = [];
    let eurGains = [];
    for (; z < csvAllRows.length; z++) {
	    if (z >1) {

            // Add more Symbols need to make dynamic
            obvBond.close.push(parseFloat(symbols[0].secondSymbolAllRows[z][4]));
            obvBond.volume.push(parseFloat(symbols[0].secondSymbolAllRows[z][6]));
            
            obvTrs.close.push(parseFloat(symbols[1].secondSymbolAllRows[z][4]));
            obvTrs.volume.push(parseFloat(symbols[1].secondSymbolAllRows[z][6]));

            obvEur.close.push(parseFloat(symbols[2].secondSymbolAllRows[z][4]));
            obvEur.volume.push(parseFloat(symbols[2].secondSymbolAllRows[z][6]));

            obv.close.push(parseFloat(csvAllRows[z][4]));
            obv.volume.push(parseFloat(csvAllRows[z][6]));	
            
            gainsOnly.push(parseFloat(csvAllRows[z][7]));	

            bondGains.push(parseFloat(csvAllRows[z][18]));
            obvTrsGains.push(parseFloat(csvAllRows[z][22]));
            eurGains.push(parseFloat(csvAllRows[z][26]));

            let expon = {"gain":csvAllRows[z][7],"expon":0};
            gainsAndDate[csvAllRows[z][0]] = expon;
	     } 
    }

    console.log("gainsOnly:" + gainsOnly.length);
        
    //FIXME: Add more Symbols need to make dynamic
    let period = 8;
    let emaValues = EMA.calculate({period : period, values : gainsOnly});
    let obvValues = OBV.calculate(obv);
    
    let bondEmaValues = EMA.calculate({period : period, values : bondGains});
    let bondObvValues = OBV.calculate(obvBond);
    let trsEmaValues = EMA.calculate({period : period, values : obvTrsGains});
    let trsObvValues = OBV.calculate(obvTrs);
    let eurEmaValues = EMA.calculate({period : period, values : eurGains});
    let eurObvValues = OBV.calculate(obvEur);

    console.log("emaValues length:" + emaValues.length);
    console.log("obv values  length:" + obvValues.length);
    console.log("bondvalues: " + bondEmaValues.length);
    console.log("obv values: " + bondObvValues.length);
    console.log(bondEmaValues[100]);
   
    let  t = 0;
    for (;t < period + 1; t++) {
        emaValues.unshift(0);
        bondEmaValues.unshift(0);
        trsEmaValues.unshift(0);
        eurEmaValues.unshift(0);
    }

    t = 0;
    for (;t < 3; t++) {
       obvValues.unshift(0);
       bondObvValues.unshift(0);
       trsObvValues.unshift(0);
       eurObvValues.unshift(0);
    } 

    console.log("csvAllROws length" + csvAllRows.length);
    console.log("emaValues length" + emaValues.length);
    
    z = 1;
   for (; z < csvAllRows.length;z++) {


            //FIXME: Add more Symbols need to make dynamic

            csvAllRows[z][20]= bondEmaValues[z].toFixed(3);
            csvAllRows[z][24]= trsEmaValues[z].toFixed(3);
            csvAllRows[z][28]= eurEmaValues[z].toFixed(3);


            csvAllRows[z][16] = emaValues[z].toFixed(3);
            let tripleSmoothed = (parseFloat(obvValues[z] - obvValues[z-1]) / obvValues[z-1]);
            csvAllRows[z][17] = tripleSmoothed.toFixed(3);
           
            let tripleSmoothedBond = (parseFloat(bondObvValues[z] - bondObvValues[z-1]) / bondObvValues[z-1]);
            csvAllRows[z][21] = tripleSmoothedBond.toFixed(3);  

            let tripleSmoothedTrs = (parseFloat(trsObvValues[z] - trsObvValues[z-1]) / trsObvValues[z-1]);
            csvAllRows[z][25] = tripleSmoothedTrs.toFixed(3);       

            let tripleSmoothedEur = (parseFloat(eurObvValues[z] - eurObvValues[z-1]) / eurObvValues[z-1]);
            csvAllRows[z][29] = tripleSmoothedEur.toFixed(3);   
    }

    let convertedRows = "";
  let x = 0;
  for (; x < csvAllRows.length; x++) {
            // Set buy and sell

            if (true && csvAllRows[x]) {
                
                if (csvAllRows[x][7] >= 0) {
                   if (csvAllRows[x-2]) {
                    csvAllRows[x-2][12] = "1";
                   }
                } else {
                      if (csvAllRows[x-2]) {
                    csvAllRows[x-2][12] = "-1";
                    }
                }
            }
  }
   x = 0;

   // Format Data for use in CSV
   for (; x < csvAllRows.length; x++) {
            
        convertedRows += csvAllRows[x][0] + ",";
        let printCount = 7;
        columnHeaders.forEach(function(){
            if (exportColumnHeaders[csvAllRows[0][printCount]] || printCount == 12) {
                convertedRows += csvAllRows[x][printCount] + ",";
            }  
            printCount++;
        });
        convertedRows += "\n";

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
                    let responseMessage = {msg:"saved","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow,"models":models};
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

function portfolioSimulation(res,startDate,endDate,multiple) {
    let mainPromise = new Promise(function(resolveIt, reject) {
        if (multiple) {
            startSimulation = true;
            shortPrice = 0;
            testPortfolio = 10000;  
            console.log("selected model:" + models[0].model);
            desiredBackTestModel = 0;
        }

        console.log("start " + startDate + " end " + endDate);

        let test = true;
        let custom = false;
        let activeDataObj = csvAllRows;
        if (custom) { 
        activeDataObj = customRows;	   
        } 
        simulationLog = "<ul>";
        simulationLogCsv = "type,shares,test portfolio,time,total amount bought,share price\n";
        if (false) {
            csvRowsCopySimulation = activeDataObj.slice(activeDataObj.length - 200,activeDataObj.length - 100);
        } else {
            let i = 0;
            let startIndex = 0;
            let endIndex = 0;
            for (; i < activeDataObj.length;i++) {
                if (activeDataObj[i][0] == startDate) {
                    startIndex = i;
                }  else if (activeDataObj[i][0] == endDate) {
                    endIndex = i;
                }
            }
        
            console.log("start index: " + startIndex  +  " end index: " + endIndex);
            csvRowsCopySimulation = activeDataObj.slice(startIndex,endIndex);
            console.log("last obj " + activeDataObj[endIndex][0]);
            console.log("simulation length " + csvRowsCopySimulation.length);
        }
        console.log("testPortfolio " + testPortfolio + " short " + shortPrice);
        let p = new Promise(function(resolve, reject) {
            mlPredictCounter = 0;
            totalPredictions = [];
            mlPredict(resolve,null,false,true);
        });
        p.then(function(){
            
            if (lastActiveTrade == "1") {
                console.log("testPortfolio before sell " + testPortfolio);
                console.log("shares purchased" + sharesPurchased);
                console.log("share price " + csvRowsCopySimulation[mlPredictCounter][4]);
                testPortfolio += csvRowsCopySimulation[mlPredictCounter][4] * sharesPurchased;
                console.log("testPortfolio after sell " + testPortfolio);
            } else {
                console.log("testPortfolio " + testPortfolio);
            
            }
            fs.writeFile('public/output.csv', simulationLogCsv, 'utf8', function (err) {
                if (err) {
                    console.log(err);
                    console.log('Some error occured - file either not saved or corrupted file saved.');
                }
            });

            if (multiple) {
                console.log("promise resolved");
                resolveIt();
            } else {
                res.send({"status":"success", "portfolio":testPortfolio,"log":simulationLog,simulationLogCsv:simulationLogCsv});
            }
        
        });
    });
    return mainPromise;
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
    let testMode = true;
    backTestCorrect = 0;
    backTestNonCorrect = 0;
    buyCorrectCounter = 0;
    sellCorrectCounter = 0;
    testPortfolio = 0;
    backTestBuyNonCorrect = 0;
    backTestSellNonCorrect = 0;
    
    let testCount = 0;
    backTestData = [];
    for (; u < buyData.length;u++) {
        if (buyData[u][1] == "-1" || buyData[u][1] == "1") {
            if (testMode && u < 4200) {
  	
                //break;
            } else {
            testCount++;
            let predictAccuracyObj = {decision:0,dataOneDayBackData:{},dataCurrentData:{},mlPredict:{},correct:null};
            predictAccuracyObj.decision = buyData[u][1];

            let timeMinusOneDay = moment(buyData[u][0]).subtract(1,"days").format("M/D/Y");
            predictAccuracyObj.dataOneDayBackData = csvDataMap[timeMinusOneDay];
            predictAccuracyObj.dataCurrentData =  csvDataMap[buyData[u][0]];

            if (!csvDataMap[timeMinusOneDay] || !csvDataMap[buyData[u][0]]) {
                let i = 2;
                for (; i < 5; i++) {
                    let minusNDays = moment(buyData[u][0]).subtract(i,"days").format("M/D/Y");
                    if (csvDataMap[minusNDays] != null) {
                        predictAccuracyObj.dataOneDayBackData = csvDataMap[minusNDays];
                        break;
                    }

                }
            }
	   
   
            backTestData.push(predictAccuracyObj);
	   }
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
	    console.log("buy not correct " + backTestBuyNonCorrect);
  	    console.log("sell not correct " + backTestSellNonCorrect);
        console.log("correct buy percentage " + (1 - parseFloat(backTestBuyNonCorrect/buyCorrectCounter)));
        console.log("correct sell percentage " + (1 - parseFloat(backTestSellNonCorrect/sellCorrectCounter)));
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
        let exponAvg;

        if (activeTrade) {
            lastRow = csvRowsCopySimulation[mlPredictCounter];
        }

        if (backTest) {
            activeModel = models[desiredBackTestModel];
            lastRow = backTestData[mlPredictCounter].dataOneDayBackData;
        } else {
            activeModel = models[mlPredictCounter];
            if (activeTrade) {
                activeModel = models[desiredBackTestModel];
            }
        }
        gains = lastRow[7].toString();
        multiDayGains = lastRow[8].toString();
        smaGains = lastRow[9].toString();
        stochRsi = lastRow[10].toString();
        volume = lastRow[11].toString();
        stochAverage = lastRow[13].toString();
        smaGainAverage = lastRow[14].toString();
        buysAverage = lastRow[15].toString();
        exponAvg = lastRow[16].toString();
        tripleExponSmooth = lastRow[17].toString();

        //FIXME Make Dynamic
        let params = {
            MLModelId: activeModel.model, 
            PredictEndpoint: 'https://realtime.machinelearning.us-east-1.amazonaws.com',
            Record: {
                "Gains": gains,
                "Multi Day Gains": multiDayGains,           
                "Stoch RSI": stochRsi,
                "Single Day Volume": volume,
                "Expon Moving Avg": exponAvg,
                "Triple Expon Smoothed": tripleExponSmooth,
                "Bond Vol":lastRow[19].toString(),
                "Bond Triple":lastRow[21].toString(),
                "Trs Vol":lastRow[23].toString(),
                "Trs Expon Avg":lastRow[24].toString(),
                "Trs Triple":lastRow[25].toString(),
                "EUR Gains":lastRow[26].toString(),
                "EUR Vol":lastRow[27].toString(),
                "EUR Expon Avg":lastRow[28].toString(),
                "EUR Triple":lastRow[29].toString(),

                "Bond Expon Avg":lastRow[20].toString(),
                "Trs Gains":lastRow[22].toString(),
                "SMA Gains": smaGains,
                "Stoch Avg": stochAverage,
                "SMA Gains Avg": smaGainAverage,
                "Buys Avg": buysAverage,
                "Bond Gains": lastRow[18].toString()
            }
        };
      
    
        let p1 = new Promise(function(resolve, reject) {
            console.log("model type " + activeModel.type);
            if (activeModel.type == "local") {
                mlPredictLocal(resolve,params);
            } else {
                mlPredictAmazon(resolve,params);
            }
               
        });

        let p2 = new Promise(function(resolve, reject) {
            if (secondModelEnabled) {
                params.MLModelId = models[desiredBackTestModel + 1].model;
                mlPredictAmazon(resolve,params);
            } else {     
                resolve();
            }
        });
        
        Promise.all([p1, p2]).then(function(values) {
            let mlBuy = false;
            obj = values[0];     
            obj.hold = 0;
            totalPredictions.push(obj);

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
                    if (backTestData[mlPredictCounter].decision == "-1" && mlBuy) {
                    backTestBuyNonCorrect++;
                    } else if (backTestData[mlPredictCounter].decision == "1" && !mlBuy) {
                    backTestSellNonCorrect++;
                    }
                }
            }

            if (activeTrade) {
                mlBuy = false;
                let priceData = csvRowsCopySimulation[mlPredictCounter + 1];

                mlBuy1 = parseFloat(obj.buy) > parseFloat(obj.sell);
                if (secondModelEnabled) {
                    mlBuy2 = parseFloat(values[1].buy) > parseFloat(values[1].sell);
                    let decision = 0;
                    if (lastActiveTrade == "1" && !mlBuy1) {
                        decision = 1;
                        mlBuy = false;
                    } else if (lastActiveTrade == "-1" && mlBuy2) {
                        mlBuy = true;
                        decision = 2;
                    } else if (lastActiveTrade == "1" && mlBuy1) {
                        mlBuy = true;
                        decision = 3;
                    } else {
                        decision = 4;
                    }

                    console.log("lastactivetrade " + lastActiveTrade + " decision " + decision + " mlBuy1 " + mlBuy1 + " mlBuy2 " + mlBuy2 + " buy " + obj.buy + " sell " + obj.sell + " buy 2 " + values[1].buy+ " sell2 " + values[1].sell);
                } else {
                    mlBuy = mlBuy1;
                }
            
                if (mlBuy && (startSimulation || lastActiveTrade == "-1")) {
                    sharesPurchased = Math.floor(testPortfolio / parseFloat(priceData[4]));
                    totalValuePurchased = parseFloat(priceData[4] * sharesPurchased);
                    if (true && shortPrice != 0) {
                        let priceDiff = shortPrice - parseFloat(priceData[4]);
                        testPortfolio += (priceDiff * sharesPurchased); 
                        let shortPriceLog = "short gain diff" + priceDiff + " shares purchased " + sharesPurchased + " testPort " + testPortfolio + " time " + priceData[0] + " total bought " + totalValuePurchased + " share price " + priceData[4];
                        let shortPriceCsv = "short," + sharesPurchased + "," + testPortfolio + "," + priceData[0] + "," + totalValuePurchased + "," + priceData[4] + "\n";
                        console.log(shortPriceLog);
                        simulationLog += "<li>" + shortPriceLog + "</li>";        
                        simulationLogCsv += shortPriceCsv;            
                    }
                   
                    lastActiveTrade = "1";
                    startSimulation = false;
                    testPortfolio = testPortfolio - totalValuePurchased;
                    let buyLog = "buy: shares purchased: " + sharesPurchased + " testPort " + testPortfolio + " time " + priceData[0] + " total bought " + totalValuePurchased + " share price " + priceData[4] ;
                    let buyLogCsv = "buy," + sharesPurchased + "," + testPortfolio + "," + priceData[0] + "," + totalValuePurchased + "," + priceData[4] + "\n";
                    simulationLogCsv += buyLogCsv;            
                    console.log(buyLog);
                    simulationLog += "<li>" + buyLog + "</li>";
                } else if (!startSimulation && !mlBuy && lastActiveTrade == "1") {
                    lastActiveTrade = "-1";
                    //sharesPurchased = 38
                    totalValuePurchased = parseFloat(priceData[4] * sharesPurchased);
                    testPortfolio = testPortfolio + totalValuePurchased;
                    shortPrice = parseFloat(priceData[4]);
                    let sellLog = "sell: shares purchased: " + sharesPurchased + " testPort " + testPortfolio  + " time " + priceData[0]  + " total bought " + totalValuePurchased + " share price " + priceData[4];
                    let sellLogCsv = "sell," + sharesPurchased + "," + testPortfolio + "," + priceData[0] + "," + totalValuePurchased + "," + priceData[4] + "\n";
                    console.log(sellLog);
                    simulationLog += "<li>" + sellLog + "</li>";
                    simulationLogCsv += sellLogCsv;            
                    sharesPurchased = Math.floor(testPortfolio / parseFloat(priceData[4]));
                }
            }

            mlPredictCounter++;

            mlPredict(resolve,lastRow,backTest,activeTrade);

        });

    } else {
        resolve();
    }
}


function mlPredictAmazon(resolve,params) {
    ml.predict(params, function(err, data) {
        let obj = {};    
        if (err) {
            console.log(err, err.stack);
        } else {     
            obj.buy = data["Prediction"]["predictedScores"][1].toFixed(3);
            if (data["Prediction"]["predictedScores"][-1]) {
                obj.sell = data["Prediction"]["predictedScores"][-1].toFixed(3);
            }
            obj.hold = 0; 
            obj.type = params.MLModelId;
        }
        resolve(obj)
    });
}

function mlPredictLocal(resolve,params) {
    let obj = {}; 
    let requestBody = Object.values(params.Record);
    request.post({
        method:'POST',
        headers: { 
            'Content-Type' : 'application/json' 
         },
        uri:'http://127.0.0.1:5002/predict',
        json:requestBody.slice(0,15)},
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                if (body.prediction == 1) {
                    obj.buy = 1;
                    obj.sell = 0;
                } else {
                    obj.sell = 1;
                    obj.buy = 0;
                }
                obj.hold = 0;
                obj.type = "local"
            }
            resolve(obj)
        }
    );
}

app.get('/download/:editing', function(req, res) {
    symbols = [{},{}];
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
    downloadCsv(res,"SPY");
});
app.post('/save', function(req, res) {
    addData(req.body,res);
});

app.get('/test/backTest/:model', function(req, res) {
    testPortfolio = 10000;
    if (req.param("model")) {
        models[0] = req.param("model");
    }  
    desiredBackTestModel = 0;
    backTest(res);

});
app.get('/test/simulate/:startDate/:endDate/:model', function(req, res) {
        startSimulation = true;
        shortPrice = 0;
	testPortfolio = 10000;
	if (req.param("model")) {
         models[0].model = req.param("model");
    }  
    console.log("selected model:" + models[0].model);
    desiredBackTestModel = 0;
         
	portfolioSimulation(res,req.param("startDate"),req.param("endDate"));
});

const average = arr => arr.reduce((sume, el) => sume + el, 0) / arr.length;


app.get('/test/simulateMultiplePoints/', function(req, res) {

    console.log("selected model:" + models[0].model);
    desiredBackTestModel = 0;
    let testPortfolioArr = [];
    // Awful fix this
    portfolioSimulation(res,"2018-10-01","2018-11-16",true)
    .then(function(port) {
        testPortfolioArr.push(testPortfolio);
        portfolioSimulation(res,"2018-10-29","2018-11-16",true)
        .then(function(port) {
            testPortfolioArr.push(testPortfolio);
            portfolioSimulation(res,"2018-06-27","2018-09-20",true).then(function(port){
                testPortfolioArr.push(testPortfolio);
                portfolioSimulation(res,"2018-04-06","2018-11-12",true).then(function(port){
                    testPortfolioArr.push(testPortfolio);
                    console.log("final");
                    console.log(testPortfolioArr);
                    console.log(average(testPortfolioArr));
                    res.send({"avg":average(testPortfolioArr)});    
                })
            })
        });
    });

});


app.get('/test/checkBuySellData', function(req, res) {
    checkBuySellData(res);
});

app.listen(8080, () => console.log('Example app listening on port 8080!'))
