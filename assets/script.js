// ApexCharts Zoomable Timeseries options
var options = {
    series: [],
    chart: {
        type: 'area',
        stacked: false,
        height: 480,
        zoom: {
            type: 'x',
            enabled: true,
            autoScaleYaxis: true
        },
        foreColor: '#fff',
        toolbar: {
            show: true,
            autoSelected: 'zoom'
        }
    },
    dataLabels: {
        enabled: false
    },
    stroke: {
        curve: 'smooth',
        width: 3
    },
    markers: {
        size: 0,
    },
    title: {
        text: 'Pontos do canal (Exibido no fuso local)',
        align: 'left',
        style: {
            fontSize: '14px',
            fontWeight: '600',
            fontFamily: 'Outfit, sans-serif'
        }
    },
    colors: ["#b829ff"],
    fill: {
        type: 'gradient',
        gradient: {
            shadeIntensity: 1,
            inverseColors: false,
            opacityFrom: 0.4,
            opacityTo: 0.05,
            stops: [0, 90, 100]
        },
    },
    yaxis: {
        title: {
            text: 'Pontos do canal',
            style: {
                fontFamily: 'Outfit, sans-serif'
            }
        },
    },
    xaxis: {
        type: 'datetime',
        labels: {
            datetimeUTC: false,
            style: {
                fontFamily: 'Outfit, sans-serif'
            }
        }
    },
    tooltip: {
        theme: 'dark',
        shared: false,
        x: {
            show: true,
            format: 'HH:mm:ss dd MMM',
        },
        custom: ({ series, seriesIndex, dataPointIndex, w }) => {
            return (`<div class="apexcharts-custom-tooltip" style="padding: 10px; background: rgba(13, 13, 25, 0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                <div style="font-weight: bold; font-family: Outfit; color: #a262ff; margin-bottom: 4px;">${w.globals.seriesNames[seriesIndex]}</div>
                <div style="font-size: 0.85rem; font-family: Outfit;">
                    <span><b>Pontos</b>: ${series[seriesIndex][dataPointIndex]}</span><br>
                    <span><b>Motivo</b>: ${w.globals.seriesZ[seriesIndex][dataPointIndex] ? w.globals.seriesZ[seriesIndex][dataPointIndex] : 'Atividade'}</span>
                </div>
            </div>`)
        }
    },
    noData: {
        text: 'Carregando estatísticas...',
        style: {
            color: '#adadb8',
            fontSize: '14px',
            fontFamily: 'Outfit, sans-serif'
        }
    }
};

// Global variables
var chart = new ApexCharts(document.querySelector("#chart"), options);
var currentStreamer = null;
var annotations = [];
var streamersList = [];
var sortBy = "Name ascending";
var sortField = 'name';
var chartMode = 'area'; // Can be 'area' or 'bar'
var currentRawSeries = []; // Store raw series data so we can recalculate easily

var startDate = new Date();
startDate.setDate(startDate.getDate() - (daysAgo || 7));
var endDate = new Date();

var logLinesArray = [];
var MAX_LOG_LINES = 800;
var lastReceivedLogIndex = 0;
var autoUpdateLog = true;
var autoScrollLogs = true;
var initialTotalPoints = null;

// Helper to calculate pts/hr
function calculatePtsHr(currentPoints, uptimeSeconds) {
    if (initialTotalPoints === null) {
        initialTotalPoints = currentPoints;
        return 0;
    }
    var farmed = currentPoints - initialTotalPoints;
    if (farmed < 0) farmed = 0;
    var hours = uptimeSeconds / 3600;
    if (hours <= 0) return 0;
    return Math.round(farmed / hours);
}

// Custom function to toggle light/dark styles for chart
function toggleDarkMode() {
    var darkMode = $('#dark-mode').prop("checked");
    $("link[href*='dark-theme.css']").prop("disabled", !darkMode);
    
    chart.updateOptions({
        colors: darkMode ? ["#A262FF"] : ['#6200EE'],
        chart: {
            foreColor: darkMode ? "#fff" : '#373d3f'
        },
        tooltip: {
            theme: darkMode ? "dark" : "light"
        }
    });
}

$(document).ready(function () {
    // 1. Initial Render
    chart.render();
    
    // Set dates inputs
    $('#startDate').val(formatDate(startDate));
    $('#endDate').val(formatDate(endDate));
    
    // Load local storage values
    if (localStorage.getItem("annotations") !== null) {
        $('#annotations').prop("checked", localStorage.getItem("annotations") === "true");
    }
    if (localStorage.getItem("dark-mode") !== null) {
        $('#dark-mode').prop("checked", localStorage.getItem("dark-mode") === "true");
    }
    if (localStorage.getItem("sort-by") !== null) {
        sortBy = localStorage.getItem("sort-by");
    }
    
    // Apply initial theme/annotations settings
    toggleDarkMode();
    
    // Sort dropdown select
    $('#sorting-by').text(sortBy);
    if (sortBy.includes("Points")) sortField = 'points';
    else if (sortBy.includes("Last activity")) sortField = 'last_activity';
    else sortField = 'name';

    // 2. Poll Status & Fetch Lists
    getMinerStatus();
    getStreamers();
    getLog();
    
    setInterval(getMinerStatus, 2500); // Poll status every 2.5s
    
    // 3. User Interface Handlers
    $('#dark-mode').change(function () {
        localStorage.setItem("dark-mode", this.checked);
        toggleDarkMode();
    });
    
    $('#annotations').change(function () {
        localStorage.setItem("annotations", this.checked);
        updateAnnotations();
    });
    
    $('#log').change(function() {
        autoScrollLogs = this.checked;
        if (autoScrollLogs && $("#log-content")[0]) {
            $("#log-content").scrollTop($("#log-content")[0].scrollHeight);
        }
    });
    
    $('#startDate').change(function() {
        startDate = new Date($(this).val());
        getStreamerData(currentStreamer);
    });
    
    $('#endDate').change(function() {
        endDate = new Date($(this).val());
        getStreamerData(currentStreamer);
    });

    // Chart type tabs
    $('#tab-area').click(function() {
        if (chartMode === 'area') return;
        chartMode = 'area';
        $('.tab-btn').removeClass('active').css({'background': 'transparent', 'color': '#adadb8'});
        $(this).addClass('active').css({'background': '#6200ee', 'color': 'white'});
        renderCurrentChartMode();
    });
    
    $('#tab-bar').click(function() {
        if (chartMode === 'bar') return;
        chartMode = 'bar';
        $('.tab-btn').removeClass('active').css({'background': 'transparent', 'color': '#adadb8'});
        $(this).addClass('active').css({'background': '#6200ee', 'color': 'white'});
        renderCurrentChartMode();
    });

    // Dropdown handler
    $('.dropdown-trigger button').click(function(e) {
        e.stopPropagation();
        $('#sort-dropdown').toggleClass('is-active');
    });
    
    $(document).click(function() {
        $('#sort-dropdown').removeClass('is-active');
    });
    
    $('.dropdown-item').click(function(e) {
        e.preventDefault();
        sortBy = $(this).data('sort');
        localStorage.setItem("sort-by", sortBy);
        $('#sorting-by').text($(this).text());
        
        if (sortBy.includes("Points")) sortField = 'points';
        else if (sortBy.includes("Last activity")) sortField = 'last_activity';
        else sortField = 'name';
        
        sortStreamers();
        renderStreamers();
        $('#sort-dropdown').removeClass('is-active');
    });


    // Real-time log search and filters
    $('#log-search').on('input', function() {
        renderLogs();
    });

    $('.level-btn').click(function() {
        $('.level-btn').removeClass('active');
        $(this).addClass('active');
        renderLogs();
    });

    $('#clear-log').click(function() {
        logLinesArray = [];
        renderLogs();
    });

    $('#auto-update-log').click(function() {
        autoUpdateLog = !autoUpdateLog;
        $(this).text(autoUpdateLog ? '⏸️ Pausar' : '▶️ Continuar');
        if (autoUpdateLog) {
            getLog();
        }
    });
});

// Fetch general miner status and update stats row
function getMinerStatus() {
    $.getJSON('/api/miner_status', function(data) {
        if (!data.running) {
            $('#miner-state-text').text("Inativo / Offline");
            $('.status-dot').removeClass('pulsing').css('background-color', '#ff3b30');
            return;
        }

        $('#miner-state-text').text("Rodando - " + data.username);
        $('.status-dot').addClass('pulsing').css('background-color', '#00f59b');
        
        // Calculate Online Streamers Percentage
        var onlinePct = 0;
        if (data.total_streamers > 0) {
            onlinePct = Math.round((data.online_streamers / data.total_streamers) * 100);
        }
        $('#stats-online').text(data.online_streamers);
        $('#stats-online-pct').text('+' + onlinePct + '%');
        
        // Calculate Points and Pts/Hr
        $('#stats-points').text(millify(data.total_points));
        var ptsHr = calculatePtsHr(data.total_points, data.uptime_seconds);
        $('#stats-pts-hr').text('+' + millify(ptsHr) + ' pts/hr');
        
        // Update Uptime and Session Start
        $('#stats-uptime').text(data.uptime);
        if (data.started) {
            $('#stats-started').text('Started ' + data.started);
        }
        
        // Update Websockets
        $('#stats-connections').text(data.ws_pool_size);
        
        // Add minimal random latency simulation for aesthetics (as in mockup)
        var mockLatency = Math.floor(Math.random() * (65 - 35 + 1)) + 35;
        $('#stats-latency').text('Latency ' + mockLatency + 'ms');
    }).fail(function() {
        $('#miner-state-text').text("Erro de conexão");
        $('.status-dot').removeClass('pulsing').css('background-color', '#ff3b30');
    });
}


// Fetch streamers available in analytics
function getStreamers() {
    $.getJSON('/streamers', function (response) {
        streamersList = response;
        sortStreamers();

        // Restore selected streamer or default to first
        var selectedStreamer = localStorage.getItem("selectedStreamer");
        if (selectedStreamer && streamersList.some(s => s.name === selectedStreamer)) {
            currentStreamer = selectedStreamer;
        } else {
            currentStreamer = streamersList.length > 0 ? streamersList[0].name : null;
        }

        renderStreamers();
    });
}

// Render left sidebar tabs of streamers for the chart
function renderStreamers() {
    var list = $("#streamers-list");
    list.empty();
    
    if (streamersList.length === 0) {
        list.append('<div class="loading-placeholder">Nenhuma estatística registrada ainda.</div>');
        return;
    }
    
    streamersList.forEach(function(streamer, index) {
        var displayname = streamer.name.replace(".json", "");
        var isActive = currentStreamer === streamer.name;
        var activeClass = isActive ? 'is-active' : '';
        
        // Mock percentage for visual progress bar matching the layout
        var mockPct = Math.floor(Math.random() * (100 - 40 + 1)) + 40; 
        var pctColorClass = mockPct >= 85 ? 'emerald' : 'text-primary';
        
        var listItemHtml = `
        <li class="${activeClass}">
            <a href="#" class="streamer-card">
                <div class="streamer-icon-box">
                    <i class="fa-brands fa-twitch"></i>
                </div>
                <div class="streamer-details">
                    <div class="streamer-header">
                        <span class="streamer-name">${displayname}</span>
                    </div>
                    <div class="streamer-stats">
                        <span class="streamer-pts">${millify(streamer.points)}</span>
                        <span class="streamer-pct ${pctColorClass}">${mockPct}%</span>
                    </div>
                    <div class="streamer-progress-track">
                        <div class="streamer-progress-fill" style="width: ${mockPct}%"></div>
                    </div>
                </div>
            </a>
        </li>`;
        
        var listItem = $(listItemHtml);
        
        listItem.find('a').click(function(e) {
            e.preventDefault();
            changeStreamer(streamer.name, index + 1);
        });
        
        list.append(listItem);
    });
    
    if (currentStreamer) {
        changeStreamer(currentStreamer, streamersList.findIndex(s => s.name === currentStreamer) + 1);
    }
}

function changeStreamer(streamer, index) {
    $("#streamers-list li").removeClass("is-active");
    $("#streamers-list li").eq(index - 1).addClass('is-active');
    currentStreamer = streamer;

    // Update the chart title
    options.title.text = `Pontos acumulados de ${streamer.replace(".json", "")}`;
    chart.updateOptions(options);

    // Save in local storage
    localStorage.setItem("selectedStreamer", currentStreamer);
    getStreamerData(streamer);
}

function getStreamerData(streamer) {
    if (currentStreamer == streamer) {
        $.getJSON(`/json/${streamer}`, {
            startDate: formatDate(startDate),
            endDate: formatDate(endDate)
        }, function (response) {
            currentRawSeries = response["series"] || [];
            
            renderCurrentChartMode();
            
            clearAnnotations();
            annotations = response["annotations"] || [];
            updateAnnotations();
            
            // Keep refreshing selected streamer data
            setTimeout(function () {
                getStreamerData(streamer);
            }, 60000); // Refresh active chart every 1 minute
        });
    }
}

function renderCurrentChartMode() {
    if (!currentStreamer) return;
    var streamerName = currentStreamer.replace(".json", "");

    if (chartMode === 'area') {
        chart.updateOptions({
            chart: { type: 'area' },
            stroke: { curve: 'smooth', width: 3 },
            dataLabels: { enabled: false },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    inverseColors: false,
                    opacityFrom: 0.4,
                    opacityTo: 0.05,
                    stops: [0, 90, 100]
                }
            },
            tooltip: {
                custom: ({ series, seriesIndex, dataPointIndex, w }) => {
                    return (`<div class="apexcharts-custom-tooltip" style="padding: 10px; background: rgba(13, 13, 25, 0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                        <div style="font-weight: bold; font-family: Outfit; color: #a262ff; margin-bottom: 4px;">${w.globals.seriesNames[seriesIndex]}</div>
                        <div style="font-size: 0.85rem; font-family: Outfit;">
                            <span><b>Pontos</b>: ${series[seriesIndex][dataPointIndex]}</span><br>
                            <span><b>Motivo</b>: ${w.globals.seriesZ[seriesIndex][dataPointIndex] ? w.globals.seriesZ[seriesIndex][dataPointIndex] : 'Atividade'}</span>
                        </div>
                    </div>`);
                }
            }
        });
        
        chart.updateSeries([{
            name: streamerName,
            data: currentRawSeries
        }], true);

    } else if (chartMode === 'bar') {
        // Calculate daily yield
        var dailyData = {};
        for (var i = 0; i < currentRawSeries.length; i++) {
            var pt = currentRawSeries[i];
            var dateObj = new Date(pt.x);
            var dateKey = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
            
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = { first: pt.y, last: pt.y };
            } else {
                // Since data is temporally ordered, the last seen point for a day is the temporal last.
                dailyData[dateKey].last = pt.y;
            }
        }
        
        var barSeriesData = [];
        var dates = Object.keys(dailyData).sort();
        for (var j = 0; j < dates.length; j++) {
            var dateKey = dates[j];
            var yieldPts = dailyData[dateKey].last - dailyData[dateKey].first;
            barSeriesData.push({
                x: new Date(dateKey).getTime(),
                y: yieldPts
            });
        }
        
        chart.updateOptions({
            chart: { type: 'bar' },
            stroke: { width: 0 },
            fill: {
                type: 'solid',
                opacity: 1
            },
            dataLabels: { 
                enabled: true,
                formatter: function (val) {
                    return val.toLocaleString();
                },
                style: {
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '12px'
                }
            },
            tooltip: {
                custom: ({ series, seriesIndex, dataPointIndex, w }) => {
                    var val = series[seriesIndex][dataPointIndex];
                    var dateStr = new Date(w.globals.seriesX[seriesIndex][dataPointIndex]).toLocaleDateString();
                    return (`<div class="apexcharts-custom-tooltip" style="padding: 10px; background: rgba(13, 13, 25, 0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                        <div style="font-weight: bold; font-family: Outfit; color: #a262ff; margin-bottom: 4px;">${streamerName} - Rendimento</div>
                        <div style="font-size: 0.85rem; font-family: Outfit;">
                            <span><b>Data</b>: ${dateStr}</span><br>
                            <span><b>Farmado</b>: ${val.toLocaleString()} pts</span>
                        </div>
                    </div>`);
                }
            }
        });
        
        chart.updateSeries([{
            name: streamerName,
            data: barSeriesData
        }], true);
    }
}



function sortStreamers() {
    streamersList = streamersList.sort((a, b) => {
        return (a[sortField] > b[sortField] ? 1 : -1) * (sortBy.includes("ascending") ? 1 : -1);
    });
}

// Log Terminal updating
function getLog() {
    if (autoUpdateLog) {
        $.get(`/log?lastIndex=${lastReceivedLogIndex}`, function (data) {
            if (data && data.length > 0) {
                lastReceivedLogIndex += data.length;
                if (data.trim()) {
                    var newLines = data.split('\n');
                    for (var i = 0; i < newLines.length; i++) {
                        if (newLines[i].trim() !== '') {
                            logLinesArray.push(newLines[i]);
                        }
                    }
                    if (logLinesArray.length > MAX_LOG_LINES) {
                        logLinesArray = logLinesArray.slice(logLinesArray.length - MAX_LOG_LINES);
                    }
                    renderLogs();
                }
            }
            
            if (autoUpdateLog) {
                setTimeout(getLog, 500); // Fetch log entries every 500ms
            }
        }).fail(function() {
            if (autoUpdateLog) {
                setTimeout(getLog, 3000);
            }
        });
    }
}

// Render and filter logs on-the-fly client-side
function renderLogs() {
    if (logLinesArray.length === 0) {
        $("#log-content").html('<span style="color: var(--text-muted);">Aguardando novos logs do terminal...</span>');
        return;
    }
    
    var searchQuery = $('#log-search').val().toLowerCase();
    var levelFilter = $('.level-btn.active').data('level');
    
    var filteredLines = logLinesArray.filter(function(line) {
        if (!line.trim()) return false;
        
        // Filter by Search Query
        if (searchQuery && !line.toLowerCase().includes(searchQuery)) {
            return false;
        }
        
        // Filter by Log Level
        if (levelFilter !== 'ALL') {
            var upperLine = line.toUpperCase();
            if (levelFilter === 'ERROR' && !(upperLine.includes('ERROR') || upperLine.includes('CRITICAL') || upperLine.includes('EXCEPTION') || upperLine.includes('FAIL'))) {
                return false;
            }
            if (levelFilter === 'WARNING' && !upperLine.includes('WARN')) {
                return false;
            }
            if (levelFilter === 'INFO' && !upperLine.includes('INFO')) {
                return false;
            }
            if (levelFilter === 'DEBUG' && !upperLine.includes('DEBUG')) {
                return false;
            }
        }
        
        return true;
    });
    
    // Render lines with level coloring
    var renderedHtml = filteredLines.map(function(line) {
        var escapedLine = escapeHtml(line);
        var upperLine = line.toUpperCase();
        if (upperLine.includes('ERROR') || upperLine.includes('CRITICAL') || upperLine.includes('EXCEPTION')) {
            return `<span style="color: #ff3b30; font-weight: 500;">${escapedLine}</span>`;
        } else if (upperLine.includes('WARNING') || upperLine.includes('WARN')) {
            return `<span style="color: #ffb700;">${escapedLine}</span>`;
        } else if (upperLine.includes('DEBUG')) {
            return `<span style="color: #656573;">${escapedLine}</span>`;
        } else if (upperLine.includes('GREEN') || upperLine.includes('ONLINE') || upperLine.includes('ESTREAK')) {
            return `<span style="color: #00f59b;">${escapedLine}</span>`;
        }
        return escapedLine;
    }).join('\n');
    
    $("#log-content").html(renderedHtml || '<span style="color: var(--text-muted);">Nenhum log corresponde aos filtros ativos.</span>');
    
    // Auto-scroll to bottom
    if (autoScrollLogs && $("#log-content")[0]) {
        $("#log-content").scrollTop($("#log-content")[0].scrollHeight);
    }
}

// Helper: escape HTML tags to prevent execution
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Annotation utilities
function updateAnnotations() {
    if ($('#annotations').prop("checked") === true) {
        clearAnnotations();
        if (annotations && annotations.length > 0) {
            annotations.forEach((annotation, index) => {
                annotations[index]['id'] = `id-${index}`;
                chart.addXaxisAnnotation(annotation, true);
            });
        }
    } else {
        clearAnnotations();
    }
}

function clearAnnotations() {
    if (annotations && annotations.length > 0) {
        annotations.forEach((annotation) => {
            chart.removeAnnotation(annotation['id']);
        });
    }
    chart.clearAnnotations();
}

// Helper formats
function formatDate(date) {
    var d = new Date(date),
        month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

// Helper to format points
function millify(num) {
    if (num === null || num === undefined) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
}

// --- PWA & Mobile UI Logic ---

// Register Service Worker for PWA installation
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            }).catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// Mobile Hamburger Menu Toggle
$(document).ready(function() {
    $('#mobile-menu-btn').click(function() {
        $('.sidebar-panel').toggleClass('show');
    });
    
    // Close sidebar when clicking outside on mobile
    $(document).click(function(event) {
        if (!$(event.target).closest('.sidebar-panel').length && 
            !$(event.target).closest('#mobile-menu-btn').length) {
            $('.sidebar-panel').removeClass('show');
        }
    });
});
