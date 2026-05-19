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
    colors: ["#A262FF"],
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
var streamersConfig = []; // Para a tabela de configurações
var sortBy = "Name ascending";
var sortField = 'name';

var startDate = new Date();
startDate.setDate(startDate.getDate() - (daysAgo || 7));
var endDate = new Date();

var allLogsContent = "";
var lastReceivedLogIndex = 0;
var autoUpdateLog = true;
var autoScrollLogs = true;

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
    getStreamersConfig();
    getStreamers();
    getLog();
    
    setInterval(getMinerStatus, 2500); // Poll status every 2.5s
    setInterval(getStreamersConfig, 10000); // Refresh online config badges
    
    // 3. User Interface Handlers
    $('#dark-mode').change(function () {
        localStorage.setItem("dark-mode", this.checked);
        toggleDarkMode();
    });
    
    $('#annotations').change(function () {
        localStorage.setItem("annotations", this.checked);
        updateAnnotations();
    });
    
    $('#startDate').change(function() {
        startDate = new Date($(this).val());
        getStreamerData(currentStreamer);
    });
    
    $('#endDate').change(function() {
        endDate = new Date($(this).val());
        getStreamerData(currentStreamer);
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

    // Add Streamer Form submission
    $('#add-streamer-form').submit(function(e) {
        e.preventDefault();
        var username = $('#new-streamer-username').val().trim().toLowerCase();
        if (!username) return;
        
        // Verificação de duplicados
        var exists = streamersConfig.some(function(item) {
            return item.username.toLowerCase() === username;
        });
        
        if (exists) {
            alert("Este streamer já está cadastrado!");
            return;
        }
        
        var newStreamer = {
            username: username,
            make_predictions: $('#setting-predictions').prop('checked'),
            follow_raid: $('#setting-raid').prop('checked'),
            claim_drops: $('#setting-drops').prop('checked'),
            watch_streak: $('#setting-streak').prop('checked'),
            is_online: false,
            points: 0,
            running: false
        };
        
        streamersConfig.push(newStreamer);
        renderStreamersConfigTable();
        
        // Reset form input
        $('#new-streamer-username').val('');
        $('#setting-predictions').prop('checked', false);
    });

    // Save Streamers list to Backend
    $('#btn-save-streamers').click(function() {
        var cleanConfig = streamersConfig.map(function(item) {
            return {
                username: item.username,
                make_predictions: item.make_predictions,
                follow_raid: item.follow_raid,
                claim_drops: item.claim_drops,
                watch_streak: item.watch_streak
            };
        });
        
        $(this).html('<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...').prop('disabled', true);
        
        $.ajax({
            url: '/api/streamers_config',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(cleanConfig),
            success: function(response) {
                alert("Streamers atualizados com sucesso e aplicados no minerador!");
                $('#btn-save-streamers').html('<i class="fa-solid fa-floppy-disk"></i> Salvar e Sincronizar Minerador').prop('disabled', false);
                getStreamersConfig();
                getStreamers();
            },
            error: function(xhr, status, error) {
                alert("Erro ao salvar streamers: " + error);
                $('#btn-save-streamers').html('<i class="fa-solid fa-floppy-disk"></i> Salvar e Sincronizar Minerador').prop('disabled', false);
            }
        });
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
        allLogsContent = "";
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

// Fetch active miner status
function getMinerStatus() {
    $.getJSON('/api/miner_status', function(data) {
        if (data.running) {
            $('#miner-state-text').text("Rodando - " + data.username);
            $('.status-dot').addClass('pulsing').css('background-color', '#00f59b');
            
            // Update Stat cards
            $('#stats-online').text(data.online_streamers + " / " + data.total_streamers);
            $('#stats-points').text(millify(data.total_points));
            $('#stats-uptime').text(data.uptime);
            $('#stats-connections').text(data.ws_pool_size + " WebSockets");
        } else {
            $('#miner-state-text').text("Inativo / Offline");
            $('.status-dot').removeClass('pulsing').css('background-color', '#ff3b30');
        }
    }).fail(function() {
        $('#miner-state-text').text("Erro de conexão");
        $('.status-dot').removeClass('pulsing').css('background-color', '#ff3b30');
    });
}

// Fetch streamers.json configuration
function getStreamersConfig() {
    $.getJSON('/api/streamers_config', function(data) {
        streamersConfig = data;
        renderStreamersConfigTable();
    });
}

// Render dynamic streamers config manager table
function renderStreamersConfigTable() {
    var tbody = $('#streamers-config-tbody');
    tbody.empty();
    
    if (streamersConfig.length === 0) {
        tbody.append('<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhum streamer cadastrado. Adicione um acima!</td></tr>');
        return;
    }
    
    streamersConfig.forEach(function(streamer, index) {
        var statusBadge = streamer.is_online ? 
            '<span class="badge-status online"><i class="fa-solid fa-signal"></i> LIVE</span>' : 
            '<span class="badge-status offline">OFFLINE</span>';
            
        var predictionsChecked = streamer.make_predictions ? 'checked' : '';
        var raidChecked = streamer.follow_raid ? 'checked' : '';
        var dropsChecked = streamer.claim_drops ? 'checked' : '';
        var streakChecked = streamer.watch_streak ? 'checked' : '';
        
        var tr = $(`
            <tr data-index="${index}">
                <td class="streamer-row-name">${streamer.username}</td>
                <td>${statusBadge}</td>
                <td class="points-text">${streamer.points ? millify(streamer.points) : '0'}</td>
                <td>
                    <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
                        <label class="checkbox-control" style="font-size: 0.75rem;">
                            <input type="checkbox" class="tbl-predict" ${predictionsChecked}> Previsão
                        </label>
                        <label class="checkbox-control" style="font-size: 0.75rem;">
                            <input type="checkbox" class="tbl-raid" ${raidChecked}> Raids
                        </label>
                        <label class="checkbox-control" style="font-size: 0.75rem;">
                            <input type="checkbox" class="tbl-drops" ${dropsChecked}> Drops
                        </label>
                        <label class="checkbox-control" style="font-size: 0.75rem;">
                            <input type="checkbox" class="tbl-streak" ${streakChecked}> Streak
                        </label>
                    </div>
                </td>
                <td>
                    <button class="action-icon-btn btn-delete-streamer" title="Remover Streamer">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `);
        
        // Bind events to table controls
        tr.find('.tbl-predict').change(function() { streamersConfig[index].make_predictions = this.checked; });
        tr.find('.tbl-raid').change(function() { streamersConfig[index].follow_raid = this.checked; });
        tr.find('.tbl-drops').change(function() { streamersConfig[index].claim_drops = this.checked; });
        tr.find('.tbl-streak').change(function() { streamersConfig[index].watch_streak = this.checked; });
        
        tr.find('.btn-delete-streamer').click(function() {
            if (confirm(`Tem certeza que deseja remover ${streamer.username}?`)) {
                streamersConfig.splice(index, 1);
                renderStreamersConfigTable();
            }
        });
        
        tbody.append(tr);
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
        
        var pointsText = `<span style="font-size: 0.75rem; background: rgba(255,255,255,0.06); padding: 0.1rem 0.35rem; border-radius: 4px; font-family: Fira Code;">${millify(streamer.points)}</span>`;
        var activeClass = isActive ? 'is-active' : '';
        
        var listItem = $(`<li class="${activeClass}"><a style="display:flex; justify-content:space-between; align-items:center;"><span><i class="fa-brands fa-twitch" style="margin-right: 6px; font-size: 0.8rem; color:#9146ff;"></i>${displayname}</span> ${pointsText}</a></li>`);
        
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
            chart.updateSeries([{
                name: streamer.replace(".json", ""),
                data: response["series"]
            }], true);
            
            clearAnnotations();
            annotations = response["annotations"];
            updateAnnotations();
            
            // Keep refreshing selected streamer data
            setTimeout(function () {
                getStreamerData(streamer);
            }, 60000); // Refresh active chart every 1 minute
        });
    }
}

function sortStreamers() {
    streamersList = streamersList.sort((a, b) => {
        return (a[sortField] > b[sortField] ? 1 : -1) * (sortBy.includes("ascending") ? 1 : -1);
    });
}

// Log Terminal updating
function getLog() {
    if (autoUpdateLog && $('#log').prop('checked')) {
        $.get(`/log?lastIndex=${lastReceivedLogIndex}`, function (data) {
            if (data && data.trim()) {
                allLogsContent += data;
                lastReceivedLogIndex += data.length;
                renderLogs();
            }
            
            if (autoUpdateLog) {
                setTimeout(getLog, 1500); // Fetch log entries every 1.5s
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
    var rawLogs = allLogsContent;
    if (!rawLogs) {
        $("#log-content").html('<span style="color: var(--text-muted);">Aguardando novos logs do terminal...</span>');
        return;
    }
    
    var lines = rawLogs.split('\n');
    var searchQuery = $('#log-search').val().toLowerCase();
    var levelFilter = $('.level-btn.active').data('level');
    
    var filteredLines = lines.filter(function(line) {
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
