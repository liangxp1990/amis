import {theme, ClassNamesFn, makeClassnames} from 'amis-core';

export const classPrefix: string = 'semi-';
export const classnames: ClassNamesFn = makeClassnames(classPrefix);

// Semi Design（字节跳动）：https://semi.design
theme('semi', {
  classPrefix: 'semi-',

  components: {
    toast: {
      closeButton: true
    }
  },

  renderers: {
    'form': {
      horizontal: {
        leftFixed: true
      }
    },

    'pagination': {
      maxButtons: 9,
      showPageInput: false
    },

    'fieldset': {
      collapsable: false
    },

    'remark': {
      placement: 'right'
    },

    'tabs': {
      mode: 'line'
    },

    'tabs-control': {
      mode: 'line'
    },

    'range-control': {
      showInput: true,
      clearable: true
    },

    'chart': {
      chartTheme: {
        color: [
          '#5769FF',
          '#8ED4E7',
          '#F58700',
          '#DCB7FC',
          '#4A9CF7',
          '#F3CC35',
          '#FE8090',
          '#8BD7D2',
          '#83B023',
          '#E9A5E5',
          '#30A7CE'
        ],
        backgroundColor: '#ffffff',
        textStyle: {},
        title: {
          textStyle: {
            color: '#1c1f23'
          },
          subtextStyle: {
            color: '#888d92'
          }
        },
        line: {
          itemStyle: {
            borderWidth: 1
          },
          lineStyle: {
            width: 2
          },
          symbolSize: 4,
          symbol: 'emptyCircle',
          smooth: false
        },
        radar: {
          itemStyle: {
            borderWidth: 1
          },
          lineStyle: {
            width: 2
          },
          symbolSize: 4,
          symbol: 'emptyCircle',
          smooth: false
        },
        bar: {
          itemStyle: {
            barBorderWidth: 0,
            barBorderColor: '#c6cacd'
          }
        },
        pie: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        scatter: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        boxplot: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        parallel: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        sankey: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        funnel: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        gauge: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          }
        },
        candlestick: {
          itemStyle: {
            color: '#c23531',
            color0: '#314656',
            borderColor: '#c23531',
            borderColor0: '#314656',
            borderWidth: 1
          }
        },
        graph: {
          itemStyle: {
            borderWidth: 0,
            borderColor: '#c6cacd'
          },
          lineStyle: {
            width: 1,
            color: '#aaa'
          },
          symbolSize: 4,
          symbol: 'emptyCircle',
          smooth: false,
          color: [
            '#5769FF',
            '#8ED4E7',
            '#F58700',
            '#DCB7FC',
            '#4A9CF7',
            '#F3CC35',
            '#FE8090',
            '#8BD7D2',
            '#83B023',
            '#E9A5E5',
            '#30A7CE'
          ],
          label: {
            color: '#f5f5f5'
          }
        },
        map: {
          itemStyle: {
            normal: {
              areaColor: '#f2f3f4',
              borderColor: '#444',
              borderWidth: 0.5
            },
            emphasis: {
              areaColor: 'rgba(255,215,0,0.8)',
              borderColor: '#444',
              borderWidth: 1
            }
          },
          label: {
            normal: {
              textStyle: {
                color: '#000'
              }
            },
            emphasis: {
              textStyle: {
                color: 'rgb(100,0,0)'
              }
            }
          }
        },
        geo: {
          itemStyle: {
            normal: {
              areaColor: '#f2f3f4',
              borderColor: '#444',
              borderWidth: 0.5
            },
            emphasis: {
              areaColor: 'rgba(255,215,0,0.8)',
              borderColor: '#444',
              borderWidth: 1
            }
          },
          label: {
            normal: {
              textStyle: {
                color: '#000'
              }
            },
            emphasis: {
              textStyle: {
                color: 'rgb(100,0,0)'
              }
            }
          }
        },
        categoryAxis: {
          axisLine: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisTick: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisLabel: {
            show: true,
            textStyle: {
              color: '#888d92'
            }
          },
          splitLine: {
            show: false,
            lineStyle: {
              color: ['#c6cacd']
            }
          },
          splitArea: {
            show: false,
            areaStyle: {
              color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
            }
          }
        },
        valueAxis: {
          axisLine: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisTick: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisLabel: {
            show: true,
            textStyle: {
              color: '#888d92'
            }
          },
          splitLine: {
            show: true,
            lineStyle: {
              color: ['#f2f3f4']
            }
          },
          splitArea: {
            show: false,
            areaStyle: {
              color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
            }
          }
        },
        logAxis: {
          axisLine: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisTick: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisLabel: {
            show: true,
            textStyle: {
              color: '#888d92'
            }
          },
          splitLine: {
            show: true,
            lineStyle: {
              color: ['#f2f3f4']
            }
          },
          splitArea: {
            show: false,
            areaStyle: {
              color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
            }
          }
        },
        timeAxis: {
          axisLine: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisTick: {
            show: true,
            lineStyle: {
              color: '#888d92'
            }
          },
          axisLabel: {
            show: true,
            textStyle: {
              color: '#888d92'
            }
          },
          splitLine: {
            show: true,
            lineStyle: {
              color: ['#f2f3f4']
            }
          },
          splitArea: {
            show: false,
            areaStyle: {
              color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
            }
          }
        },
        toolbox: {
          iconStyle: {
            normal: {
              borderColor: '#888d92'
            },
            emphasis: {
              borderColor: '#666'
            }
          }
        },
        legend: {
          textStyle: {
            color: '#1c1f23'
          }
        },
        tooltip: {
          axisPointer: {
            lineStyle: {
              color: '#c6cacd',
              width: 1
            },
            crossStyle: {
              color: '#c6cacd',
              width: 1
            }
          }
        },
        timeline: {
          lineStyle: {
            color: '#293c55',
            width: 1
          },
          itemStyle: {
            normal: {
              color: '#293c55',
              borderWidth: 1
            },
            emphasis: {
              color: '#a9334c'
            }
          },
          controlStyle: {
            normal: {
              color: '#293c55',
              borderColor: '#293c55',
              borderWidth: 0.5
            },
            emphasis: {
              color: '#293c55',
              borderColor: '#293c55',
              borderWidth: 0.5
            }
          },
          checkpointStyle: {
            color: '#e43c59',
            borderColor: 'rgba(194,53,49, 0.5)'
          },
          label: {
            normal: {
              textStyle: {
                color: '#293c55'
              }
            },
            emphasis: {
              textStyle: {
                color: '#293c55'
              }
            }
          }
        },
        visualMap: {
          color: ['#bf444c', '#d88273', '#f6efa6']
        },
        dataZoom: {
          backgroundColor: 'rgba(47,69,84,0)',
          dataBackgroundColor: 'rgba(47,69,84,0.3)',
          fillerColor: 'rgba(167,183,204,0.4)',
          handleColor: '#a7b7cc',
          handleSize: '100%',
          textStyle: {
            color: '#1c1f23'
          }
        },
        markPoint: {
          label: {
            color: '#f5f5f5'
          },
          emphasis: {
            label: {
              color: '#f5f5f5'
            }
          }
        }
      }
    }
  }
});
