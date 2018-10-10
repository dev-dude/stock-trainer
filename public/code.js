
  let csvData;
  let allSaves = [];
  let url = new URL(window.location.href);
  let edit = url.searchParams.get("edit") == "true" ? true : false;
  let simulateEnabled = url.searchParams.get("simulate") == "true" ? true : false;
  let server = "http://"+window.location.hostname+":8080";
  let firstPoint = true;
  let points = [];
  let activePoint = 1;

 
  function simulate() {  
        $("#end-portfolio").val("");
        $("#simulation-log").html("");  
        $("#simulation-log-csv").text("");  
        $("#end-profit").val(0);  
        $("#end-portfolio").val(0);     

        $.get(server + '/test/simulate/'+points[0].time+'/'+points[1].time, function(response) {
            $("#simulate-button").prop("disabled",false);
            $(".loader").hide();
            $("#end-portfolio").val(response.portfolio);
            $("#simulation-log").html(response.log);
            $("#simulation-log-csv").text(response.simulationLogCsv); 
            $("#end-profit").val((parseFloat(response.portfolio) - 10000)/10000);
        });      
  }

  $(document).ready(function() {
    $(".loader").hide();

    $("#simulate-button").click(function(){
        $("#simulate-button").prop("disabled",true);
        $(".loader").show();
        simulate();
      });
      $("#simulateDate2").addClass("border-primary");
      $("#simulate-click-1").click(function(){
         $(".loader").hide();
          setSimulationDate(0);
          $("#simulateDate1").addClass("border-primary");
          $("#simulateDate2").removeClass("border-primary");

      });
      $("#simulate-click-2").click(function(){
        setSimulationDate(1);
        $("#simulateDate2").addClass("border-primary");
        $("#simulateDate1").removeClass("border-primary");
      });
  });


function setSimulationDate(button) {
    activePoint = button;
}

function clickGraph(category,y) {
    console.log(category);
    console.log(y);
    let timestamp = moment.unix(category/1000);
    let backObj = {value:y,time:timestamp.utc().format("Y-MM-DD")};

    points[activePoint] = backObj;
  
    if (activePoint == 0) {
        $("#simulateDate1").val(points[0].time + " - " + points[0].value);       
    } else if (activePoint == 1) {
        $("#simulateDate2").val(points[1].time  + " - " + points[1].value);
    }

    if (points[0] && points[1]) {
        $("#baseProfit").val((parseFloat(points[1].value) - parseFloat(points[0].value))/parseFloat(points[0].value));
    }
    
    $.post(server + '/save', backObj, function(response) {
        let responseCopy = Object.assign({}, response);
        console.log(responseCopy);
        allSaves.unshift(responseCopy);     
        let items = "<ul>";
        let i = 0;
        for (;i < allSaves.length; i++) {
            console.log(allSaves[i][0]);
            let val = parseFloat(allSaves[i].value);
            let lastClick =  allSaves[i].isBuy ? "buy" : "sell";
            items += "<li>" + allSaves[i].data[0] + "-" + parseFloat(allSaves[i].data[4]).toFixed(2) + "- Last Click - " + lastClick + "</li>";
        }
        items += "</ul>";
        let els = "<ul>";
        responseCopy.predictions.forEach(function(prediction){
            els += "<li> buy: " + prediction.buy + " sell:" +prediction.sell + " hold: " + prediction.hold + " model: " + prediction.type + "</li>";
        });
        els +="</ul>"
        $('#predictions').html(els);
        $("#allSaves").html(items);
        $('#lastRow').html("<ul><li>"+JSON.stringify(responseCopy.lastRow)+"</li></ul>");
    }, 'json');
 
}

  $.getJSON(server + "/download/" + edit, function (data) {

 
      csvData = data;
      // Create the chart


    console.log(data);
    let chart = Highcharts.stockChart('container', {
  
  
          rangeSelector: {
              selected: 1
          },
          yAxis: [{ // Primary yAxis
                labels: {
                    format: 'spy',
                    style: {
                        color: Highcharts.getOptions().colors[2]
                    }
                },
                title: {
                    text: '{value}',
                    style: {
                        color: Highcharts.getOptions().colors[2]
                    }
                },
                opposite: true

            }, { 
            gridLineWidth: 0,
            title: {
                text: 'rsi',
                style: {
                    color: Highcharts.getOptions().colors[0]
                }
            },
            labels: {
                format: '{value}',
                style: {
                    color: Highcharts.getOptions().colors[0]
                }
            }}, { 
            gridLineWidth: 0,
            title: {
                text: 'BND',
                style: {
                    color: Highcharts.getOptions().colors[0]
                }
            },
            labels: {
                format: '{value}',
                style: {
                    color: Highcharts.getOptions().colors[0]
                }
            }
          },
          { 
            gridLineWidth: 0,
            title: {
                text: 'TLT',
                style: {
                    color: Highcharts.getOptions().colors[0]
                }
            },
            labels: {
                format: '{value}',
                style: {
                    color: Highcharts.getOptions().colors[0]
                }
            }
          }
      
    ],
  
          title: {
              text: ''
          },
          plotOptions: {
                series: {
                    cursor: 'pointer',
                    point: {
                        events: {
                            click: function () {
                                clickGraph(this.category,this.y)
                            }
                        }
                    }
                }
            },
          series: [{
              name: 'spy',
              yAxis:0,
              data: data.csvData,
              tooltip: {
                  valueDecimals: 2
              }
          },
          {
              name: 'rsi',
              lineWidth:.5,
              yAxis:1,
              dashStyle: 'longdash',
              color: 'grey',
              data: data.rsiData,
              tooltip: {
                  valueDecimals: 2
              }
          },{
              name: 'bnd',
              yAxis:2,
              data: data.secondSymbolCsvData,
              tooltip: {
                  valueDecimals: 2
              }
          },{
              name: 'TLT',
              yAxis:2,
              data: data.thirdSymbolCsvData,
              tooltip: {
                  valueDecimals: 2
              }
          }]
      });
        let z = 0;
        for (; z < csvData.buyDataAndDateOnly.length; z++) {
            let plotLine;
            if (csvData.buyDataAndDateOnly[z].action == 1) {
                plotLine = formatPlotLines("b","black",csvData.buyDataAndDateOnly[z].timeStamp);
                chart.xAxis[0].addPlotLine(plotLine);
            } else if (csvData.buyDataAndDateOnly[z].action == -1) {
                plotLine = formatPlotLines("s","red",csvData.buyDataAndDateOnly[z].timeStamp);
                chart.xAxis[0].addPlotLine(plotLine);
            }
            
        }


        let finalRow = data.csvData[data.csvData.length -1];
        console.log(finalRow);

        clickGraph(finalRow[0],finalRow[1]);

  });

  function formatPlotLines(type,color,time) {
    let plotLine = {
    value: +time,
        width: .5,
        color: color,
        dashStyle: 'dash',
        label: {
        text: type,
            align: 'left',
            y: 0,
            x: 0
        }
    };
    return plotLine;
}

 
