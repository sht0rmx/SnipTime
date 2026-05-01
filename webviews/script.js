class Dashboard {
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.fallbackColor = "#2dd4bf";

        this.state = {
            activePeriod: "day",
            activeBreakdown: "projects",
            activeWeekBreakdown: "projects",
            activeYearBreakdown: "projects",
            selectedDateMs: Date.now(),
            data: null
        };

        this.elems = this.cacheElements();
        this.initTooltip();
        this.bindEvents();

        this.requestStats();
        setInterval(() => this.requestStats(), 35000);
    }

    cacheElements() {
        return {
            common: {
                generatedAt: document.getElementById("generatedAt"),
                refresh: document.getElementById("refresh"),
                todayButton: document.getElementById("todayButton")
            },
            nav: {
                prevDay: document.getElementById("prevDay"),
                nextDay: document.getElementById("nextDay"),
                prevWeek: document.getElementById("prevWeek"),
                nextWeek: document.getElementById("nextWeek"),
                prevYear: document.getElementById("prevYear"),
                nextYear: document.getElementById("nextYear"),
                dateButton: document.getElementById("dateButton"),
                dateButtonLabel: document.getElementById("dateButtonLabel"),
                datePopover: document.getElementById("datePopover"),
                calendarDate: document.getElementById("calendarDate")
            },
            overview: {
                todayMetric: document.getElementById("todayMetric"),
                lifetimeMetric: document.getElementById("lifetimeMetric"),
                lifetimeSummary: document.getElementById("lifetimeSummaryTotal"),
                selectedDayCard: document.getElementById("selectedDayCard"),
                todayCard: document.getElementById("todayCard"),
            },
            day: {
                label: document.getElementById("dayLabel"),
                donutSegments: document.getElementById("donutSegments"),
                donutValue: document.getElementById("donutValue"),
                donutLabel: document.getElementById("donutLabel"),
                breakdownList: document.getElementById("breakdownList"),
                summaryTotal: document.getElementById("daySummaryTotal"),
                summaryLabel: document.getElementById("daySummaryLabel"),
                todayTotal: document.getElementById("todaySummaryTotal"),
                todayMeta: document.getElementById("todaySummaryMeta")
            },
            week: {
                subtitle: document.getElementById("weekSubtitle"),
                total: document.getElementById("weekTotal"),
                chart: document.getElementById("weekChart"),
                breakdownList: document.getElementById("weekBreakdownList"),
                summaryTotal: document.getElementById("weekSummaryTotal"),
                summaryRange: document.getElementById("weekSummaryRange")
            },
            year: {
                title: document.getElementById("yearTitle"),
                total: document.getElementById("yearTotal"),
                chart: document.getElementById("yearChart"),
                breakdownList: document.getElementById("yearBreakdownList"),
                summaryTotal: document.getElementById("yearSummaryTotal")
            }
        };
    }

    isToday(dateKey) {
        if (!dateKey) { return false; }
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        return dateKey === `${yyyy}-${mm}-${dd}`;
    }

    toggleDayCardVisibility(isSame) {
        const selCard = this.elems.overview.selectedDayCard;
        const grid = document.getElementById("summaryGrid");
        if (!selCard || !grid) { return; }

        if (isSame && !selCard.classList.contains('card-hidden')) {
            grid.classList.add('is-transitioning');
            selCard.classList.add('card-fading');

            selCard.getBoundingClientRect();

            setTimeout(() => {
                grid.classList.remove('grid-4');
                grid.classList.add('grid-3');

                selCard.classList.add('card-hidden');
                selCard.classList.remove('card-fading');

                grid.classList.remove('is-transitioning');
            }, 280);

        } else if (!isSame && selCard.classList.contains('card-hidden')) {
            grid.classList.remove('grid-3');
            grid.classList.add('grid-4');
            grid.classList.add('is-transitioning');

            selCard.classList.remove('card-hidden');
            selCard.classList.add('card-fading');

            void selCard.offsetWidth;

            requestAnimationFrame(() => {
                selCard.classList.remove('card-fading');
                setTimeout(() => {
                    grid.classList.remove('is-transitioning');
                }, 280);
            });
        }
    }

    initTooltip() {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.id = 'global-tooltip';
        this.tooltipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(this.tooltipEl);

        document.addEventListener('mouseover', e => {
            const target = e.target.closest('[data-tooltip]');
            if (target) {
                const raw = target.getAttribute('data-tooltip');
                this.tooltipEl.innerHTML = raw;
                this.tooltipEl.style.display = 'block';
                this.tooltipEl.style.opacity = '1';
                this._positionTooltip(e.clientX, e.clientY);
            }
        });

        document.addEventListener('mousemove', e => {
            if (this.tooltipEl.style.display === 'block') {
                this._positionTooltip(e.clientX, e.clientY);
            }
        });

        document.addEventListener('mouseout', e => {
            const target = e.target.closest('[data-tooltip]');
            if (target && !e.relatedTarget?.closest?.('[data-tooltip]')) {
                this.tooltipEl.style.opacity = '0';
                setTimeout(() => {
                    if (this.tooltipEl.style.opacity === '0') {
                        this.tooltipEl.style.display = 'none';
                        this.tooltipEl.innerHTML = '';
                    }
                }, 80);
            }
        });
    }
    _positionTooltip(mouseX, mouseY) {
        const padding = 12;
        const tooltipRect = this.tooltipEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = mouseX + padding;
        let top = mouseY + padding;

        if (left + tooltipRect.width > viewportWidth - padding) {
            left = mouseX - tooltipRect.width - padding;
        }

        if (top + tooltipRect.height > viewportHeight - padding) {
            top = mouseY - tooltipRect.height - padding;
        }

        left = Math.max(padding, Math.min(left, viewportWidth - tooltipRect.width - padding));
        top = Math.max(padding, Math.min(top, viewportHeight - tooltipRect.height - padding));

        this.tooltipEl.style.left = left + 'px';
        this.tooltipEl.style.top = top + 'px';
    }
    bindEvents() {
        document.querySelectorAll("[data-period]").forEach(button => {
            button.addEventListener("click", () => {
                const period = button.dataset.period;
                this.setActivePeriod(period);
            });
        });

        this.bindBreakdown(
            "[data-breakdown]",
            "breakdown",
            "activeBreakdown",
            data => this.renderDay(data),
            v => this.updateTabUI("[data-breakdown]", v)
        );

        this.bindBreakdown(
            "[data-week-breakdown]",
            "weekBreakdown",
            "activeWeekBreakdown",
            data => this.renderWeek(data),
            v => this.updateTabUI("[data-week-breakdown]", v, "weekBreakdown")
        );

        this.bindBreakdown(
            "[data-year-breakdown]",
            "yearBreakdown",
            "activeYearBreakdown",
            data => this.renderYear(data),
            v => this.updateTabUI("[data-year-breakdown]", v, "yearBreakdown")
        );

        this.elems.nav.prevDay.addEventListener("click", () =>
            this.moveSelectedDate(-1)
        );
        this.elems.nav.nextDay.addEventListener("click", () =>
            this.moveSelectedDate(1)
        );
        this.elems.nav.prevWeek.addEventListener("click", () =>
            this.moveSelectedWeek(-1)
        );
        this.elems.nav.nextWeek.addEventListener("click", () =>
            this.moveSelectedWeek(1)
        );
        this.elems.nav.prevYear.addEventListener("click", () =>
            this.moveSelectedYear(-1)
        );
        this.elems.nav.nextYear.addEventListener("click", () =>
            this.moveSelectedYear(1)
        );

        this.elems.common.todayButton.addEventListener("click", () => {
            this.state.selectedDateMs = Date.now();
            this.requestStats();
        });

        this.elems.common.refresh.addEventListener("click", () =>
            this.requestStats()
        );
        this.elems.nav.dateButton.addEventListener("click", e => {
            e.stopPropagation();
            this.toggleDatePopover();
        });


        this.elems.nav.calendarDate.addEventListener("change", e => {
            const target = e.currentTarget;
            if (!target.value) { return; }
            this.state.selectedDateMs = this.dateKeyToLocalMs(target.value);
            this.toggleDatePopover(false);
            this.requestStats();
        });

        window.addEventListener("click", e => {
            if (this.elems.nav.datePopover?.hidden) { return; }

            const clickedInsidePopover = e.target.closest('#datePopover');
            const clickedInsideButton = e.target.closest('#dateButton');

            if (!clickedInsidePopover && !clickedInsideButton) {
                this.toggleDatePopover(false);
            }
        });

        window.addEventListener("message", event => {
            if (event.data?.command !== "stats") { return; }
            this.state.data = event.data.data;
            this.state.selectedDateMs = this.state.data?.selectedDateMs;
            if (!this.state.data) { return; }
            this.render(this.state.data);
        });
    }

    bindBreakdown(selector, datasetKey, stateKey, render, updateTab, validator) {
        document.querySelectorAll(selector).forEach(button => {
            button.addEventListener("click", () => {
                if (!this.state.data) { return; }
                const raw = button.dataset[datasetKey];
                if (!raw) { return; }
                const value = validator ? (validator(raw) ? raw : null) : raw;
                if (!value) { return; }
                this.state[stateKey] = value;
                updateTab(value);
                render(this.state.data);
            });
        });
    }

    requestStats() {
        this.vscode.postMessage({
            command: "fetch",
            selectedDateMs: this.state.selectedDateMs
        });
    }

    moveDate(offset, unit) {
        const date = new Date(this.state.selectedDateMs);
        if (unit === "day") { date.setDate(date.getDate() + offset); }
        if (unit === "week") { date.setDate(date.getDate() + offset * 7); }
        if (unit === "year") { date.setFullYear(date.getFullYear() + offset); }
        this.state.selectedDateMs = date.getTime();
        this.requestStats();
    }

    moveSelectedDate = offset => this.moveDate(offset, "day");
    moveSelectedWeek = offset => this.moveDate(offset, "week");
    moveSelectedYear = offset => this.moveDate(offset, "year");

    setActivePeriod(period) {
        this.state.activePeriod = period;
        this.updateTabUI("[data-period]", period);
        document.querySelectorAll(".tab-panel").forEach(panel => {
            panel.hidden = panel.id !== period + "Panel";
        });
    }

    updateTabUI(selector, activeValue, dataKey = null) {
        document.querySelectorAll(selector).forEach(tab => {
            const val = dataKey
                ? tab.dataset[dataKey]
                : tab.dataset[selector.replace(/[\[\]]/g, "").split("-")[1]];
            const matches = Object.values(tab.dataset).includes(activeValue);
            tab.classList.toggle("active", matches);
        });
    }

    toggleDatePopover(forceState) {
        const popover = this.elems.nav.datePopover;
        const btn = this.elems.nav.dateButton;
        if (!popover || !btn) { return; }

        if (forceState !== undefined) {
            popover.hidden = !forceState;
        } else {
            popover.hidden = !popover.hidden;
        }

        btn.classList.toggle("open", !popover.hidden);
    }

    render(data) {
        const isCurrentDay = this.isToday(data.day.dateKey);
        this.toggleDayCardVisibility(isCurrentDay);

        this.elems.common.generatedAt.textContent =
            "Updated " + this.formatClock(data.generatedAt);
        this.elems.nav.dateButtonLabel.textContent = data.day.dateKey;
        this.elems.nav.calendarDate.value = data.day.dateKey;

        this.elems.overview.todayMetric.textContent = this.formatDuration(
            data.today.totalMs
        );
        this.elems.overview.lifetimeMetric.textContent = this.formatDuration(
            data.lifetimeMs
        );
        this.elems.overview.lifetimeSummary.textContent = this.formatDuration(
            data.lifetimeMs
        );

        this.elems.day.summaryTotal.textContent = this.formatDuration(
            data.day.totalMs
        );
        this.elems.day.summaryLabel.textContent = data.day.label;
        this.elems.day.todayTotal.textContent = this.formatDuration(
            data.today.totalMs
        );
        this.elems.day.todayMeta.textContent =
            data.today.projects[0]?.label ?? "No project yet";

        this.elems.week.summaryTotal.textContent = this.formatDuration(
            data.week.totalMs
        );
        this.elems.week.summaryRange.textContent =
            this.formatShortDate(data.week.startMs) +
            " - " +
            this.formatShortDate(data.week.endMs - 1);
        this.elems.year.summaryTotal.textContent =
            data.year.year + ": " + this.formatDuration(data.year.totalMs);

        this.renderDay(data);
        this.renderWeek(data);
        this.renderYear(data);
    }

    renderDay(data) {
        const day = data.day;
        const items = day[this.state.activeBreakdown] ?? [];

        this.elems.day.label.textContent = `${day.label} · ${this.formatDuration(day.totalMs)} `;
        this.elems.day.donutValue.textContent = this.formatDuration(day.totalMs);

        this.renderDonut(items, day.totalMs);
        this.renderBreakdownRows(day, items);
    }

    renderDonut(items, totalMs) {
        this.elems.day.donutSegments.innerHTML = "";
        if (totalMs <= 0 || !items || items.length === 0) { return; }

        const cx = 50, cy = 50, r = 42;
        const STROKE_WIDTH = 22;
        const GAP_ANGLE = 0.035; // ~2°

        // 1. Нормализация
        const normalized = items.map(i => ({
            key: i.key || i.label || i.name || 'unknown',
            label: i.label || i.name || 'Unknown',
            durationMs: Number(i.durationMs || i.time || i.value || 0),
            color: i.color || this.fallbackColor
        })).filter(i => i.durationMs > 0);

        if (normalized.length === 0) { return; }

        const itemsSum = normalized.reduce((sum, i) => sum + i.durationMs, 0);

        // 2. Слияние мелких в Other
        const MIN_PERCENT = 2;
        const mainItems = [];
        let otherMs = 0;
        normalized.sort((a, b) => b.durationMs - a.durationMs).forEach(item => {
            if ((item.durationMs / itemsSum) * 100 >= MIN_PERCENT) { mainItems.push(item); }
            else { otherMs += item.durationMs; }
        });
        if (otherMs > 0) {
            mainItems.push({ label: "Other", durationMs: otherMs, color: "var(--vscode-descriptionForeground)", key: "__other__" });
        }
        const displayItems = mainItems.slice(0, 10);

        if (displayItems.length === 1) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", cx); circle.setAttribute("cy", cy); circle.setAttribute("r", r);
            circle.setAttribute("fill", "none");
            circle.setAttribute("stroke", displayItems[0].color || this.fallbackColor);
            circle.setAttribute("stroke-width", STROKE_WIDTH);
            circle.classList.add("donut-segment");
            circle.setAttribute("data-tooltip", `<b>${displayItems[0].label}</b>${this.formatDuration(displayItems[0].durationMs)} (100%)`);
            circle.style.animation = "donutPop 400ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards";
            this.elems.day.donutSegments.appendChild(circle);
            return;
        }

        const n = displayItems.length;
        const totalGap = n * GAP_ANGLE;
        const availableAngle = 2 * Math.PI - totalGap;

        let currentAngle = -Math.PI / 2 + GAP_ANGLE;

        displayItems.forEach((item, i) => {
            const ratio = item.durationMs / itemsSum;
            const sweep = ratio * availableAngle;

            const startAngle = currentAngle;
            const endAngle = startAngle + sweep;

            const startX = cx + r * Math.cos(startAngle);
            const startY = cy + r * Math.sin(startAngle);
            const endX = cx + r * Math.cos(endAngle);
            const endY = cy + r * Math.sin(endAngle);
            const largeArc = sweep > Math.PI ? 1 : 0;

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", `M ${startX.toFixed(3)} ${startY.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", item.color || this.fallbackColor);
            path.setAttribute("stroke-width", STROKE_WIDTH);
            path.setAttribute("stroke-linecap", "butt");
            path.classList.add("donut-segment");
            path.setAttribute("data-tooltip", `<b>${item.label}</b>${this.formatDuration(item.durationMs)}<br/>${(ratio * 100).toFixed(1)}%`);
            path.style.animationDelay = `${i * 40}ms`;

            this.elems.day.donutSegments.appendChild(path);
            currentAngle = endAngle + GAP_ANGLE;
        });
    }

    renderBreakdownRows(day, items) {
        this.elems.day.breakdownList.textContent = "";
        if (items.length === 0) {
            this.elems.day.breakdownList.appendChild(this.emptyState("No time yet"));
            return;
        }

        items
            .slice(0, this.state.activeBreakdown === "files" ? 18 : 12)
            .forEach((item, index) => {
                const row = document.createElement("div");
                const header = document.createElement("div");
                const name = document.createElement("div");
                const duration = document.createElement("div");
                const track = document.createElement("div");
                const color = item.color || this.fallbackColor;

                row.className = "breakdown-row";
                row.style.animationDelay = Math.min(index * 18, 160) + "ms";
                header.className = "mb-1 flex min-w-0 items-center justify-between gap-3 text-sm";
                name.className = "flex min-w-0 items-center gap-2 font-medium";
                duration.className = "shrink-0 text-xs muted";
                track.className = "day-track";

                const icon = document.createElement("i");
                icon.className = (item.icon || "ri-pulse-line") + " shrink-0";
                icon.style.color = color;
                const label = document.createElement("span");
                label.className = "truncate";
                label.textContent = item.label;

                name.append(icon, label);
                duration.textContent = this.formatDuration(item.durationMs);
                const rawSegments = this.segmentsForItem(day, item);
                const mergedSegments = this.mergeHeartbeats(rawSegments);
                mergedSegments.forEach(segmentItem => {
                    const segment = document.createElement("span");
                    const left = ((segmentItem.startMs - day.startMs) / (day.endMs - day.startMs)) * 100;
                    const width = ((segmentItem.endMs - segmentItem.startMs) / (day.endMs - day.startMs)) * 100;
                    segment.className = "day-segment";
                    segment.style.left = Math.max(0, left) + "%";
                    segment.style.width = Math.max(0.35, width) + "%";
                    segment.style.background = color;

                    const segmentTooltip =
                        `<b>${this.formatClock(segmentItem.startMs)} – ${this.formatClock(segmentItem.endMs)}</b>` +
                        `${this.formatDuration(segmentItem.durationMs)}` +
                        (segmentItem.fileName ? `<span class="muted">${segmentItem.fileName}</span>` : '');
                    segment.setAttribute("data-tooltip", segmentTooltip);
                    track.appendChild(segment);
                });

                const tools = document.createElement("div");
                tools.className = "flex shrink-0 items-center gap-2";
                if (item.kind === "project" || item.kind === "language") {
                    const rename = document.createElement("button");
                    rename.className = "btn btn-ghost btn-xs btn-square";
                    rename.title = "Rename " + item.kind;
                    rename.innerHTML = '<i class="ri-edit-line"></i>';
                    rename.addEventListener("click", e => {
                        e.stopPropagation();
                        this.vscode.postMessage({
                            command: "renameTag",
                            kind: item.kind,
                            key: item.key,
                            label: item.label
                        });
                    });
                    tools.append(duration, rename);
                } else {
                    tools.append(duration);
                }

                header.append(name, tools);
                row.append(header, track);
                this.elems.day.breakdownList.appendChild(row);
            });
    }

    renderWeek(data) {
        if (!data) { return; }
        const max = Math.max(...data.week.days.map(day => day.durationMs), 1);
        this.elems.week.subtitle.textContent =
            this.formatShortDate(data.week.startMs) +
            " - " +
            this.formatShortDate(data.week.endMs - 1);
        this.elems.week.total.textContent = this.formatDuration(data.week.totalMs);
        this.elems.week.chart.textContent = "";

        data.week.days.forEach((day, i) => {
            this.elems.week.chart.appendChild(
                this.chartColumn(day, max, this.state.activeWeekBreakdown, i) // 🔥 + i
            );
        });
        this.renderPeriodBreakdownList(
            this.elems.week.breakdownList,
            data.week.days,
            this.state.activeWeekBreakdown,
            data.week.totalMs
        );
    }

    renderYear(data) {
        if (!data) { return; }
        const max = Math.max(...data.year.months.map(month => month.durationMs), 1);
        this.elems.year.title.textContent = String(data.year.year);
        this.elems.year.total.textContent = this.formatDuration(data.year.totalMs);
        this.elems.year.chart.textContent = "";

        data.year.months.forEach((month, i) => {
            this.elems.year.chart.appendChild(
                this.chartColumn(month, max, this.state.activeYearBreakdown, i)
            );
        });
        this.renderPeriodBreakdownList(
            this.elems.year.breakdownList,
            data.year.months,
            this.state.activeYearBreakdown,
            data.year.totalMs
        );
    }

    chartColumn(bucket, maxDurationMs, breakdownKey, index = 0) {
        const total = bucket.durationMs || 0;
        const heightPercent = total === 0 ? 0 : (total / maxDurationMs) * 100;

        const col = document.createElement("div");
        col.className = "chart-column chart-enter";
        col.style.animationDelay = `${index * 50}ms`;

        setTimeout(() => col.classList.remove("chart-enter"), 500 + (index * 50));

        const bar = document.createElement("div");
        bar.className = total > 0 ? "chart-bar" : "chart-bar empty";
        bar.style.setProperty('--bar-height', `${heightPercent}%`);
        if (total === 0) { bar.style.minHeight = "4px"; }

        col.setAttribute("data-tooltip", `<b>${bucket.label}</b>${this.formatDuration(total)}`);

        const parts = (bucket[breakdownKey] || [])
            .filter(p => p.durationMs > 0)
            .sort((a, b) => b.durationMs - a.durationMs);

        parts.forEach(item => {
            const segment = document.createElement("div");
            const segmentPercent = total > 0 ? (item.durationMs / total * 100) : 0;
            segment.className = "chart-segment";
            segment.style.height = `${segmentPercent}%`;
            segment.style.backgroundColor = item.color || this.fallbackColor;
            segment.setAttribute("data-tooltip", `<b>${item.label}</b>${this.formatDuration(item.durationMs)}<br/>${segmentPercent.toFixed(1)}%`);
            bar.appendChild(segment);
        });

        const label = document.createElement("div");
        label.className = "text-[10px] muted mt-2 text-center";
        label.textContent = bucket.label.split(' ')[0].substring(0, 3);

        col.append(bar, label);
        return col;
    }

    renderPeriodBreakdownList(container, buckets, breakdownKey, totalMs) {
        if (!container) { return; }
        container.textContent = "";
        if (!buckets || buckets.length === 0 || totalMs <= 0) {
            container.appendChild(this.emptyState("No time in this period"));
            return;
        }
        const map = new Map();
        buckets.forEach(bucket => {
            const items = bucket[breakdownKey];
            if (!items) { return; }
            items.forEach(item => {
                const existing = map.get(item.key);
                if (existing) {
                    existing.durationMs += item.durationMs;
                } else {
                    map.set(item.key, { ...item });
                }
            });
        });

        const items = Array.from(map.values()).sort((a, b) => b.durationMs - a.durationMs);
        if (items.length === 0) {
            container.appendChild(this.emptyState("No time in this period"));
            return;
        }

        items.slice(0, 12).forEach((item, index) => {
            const percent = (item.durationMs / totalMs) * 100;

            const row = document.createElement("div");
            row.className = "breakdown-row w-full";
            row.style.animationDelay = Math.min(index * 18, 160) + "ms";

            const header = document.createElement("div");
            header.className = "mb-1.5 flex w-full min-w-0 items-center justify-between gap-3 text-sm";

            const name = document.createElement("div");
            name.className = "flex min-w-0 items-center gap-2 font-medium";

            const rightSide = document.createElement("div");
            rightSide.className = "flex shrink-0 items-center gap-2 text-xs muted justify-end";

            const value = document.createElement("div");
            value.className = "shrink-0 font-medium whitespace-nowrap";
            value.textContent = `${Math.max(1, Math.round(percent))}% · ${this.formatDuration(item.durationMs)}`;
            const track = document.createElement("div");
            track.className = "progress-track";

            const fill = document.createElement("span");
            fill.className = "progress-fill";
            fill.style.width = `${Math.max(2, percent)}%`;
            fill.style.minWidth = "4px";
            fill.style.background = item.color || this.fallbackColor;
            track.appendChild(fill);

            const icon = document.createElement("i");
            icon.className = (item.icon || "ri-pulse-line") + " shrink-0 text-base";
            icon.style.color = item.color || this.fallbackColor;
            const label = document.createElement("span");
            label.className = "truncate";
            label.textContent = item.label;
            name.append(icon, label);

            if (item.secondary) {
                const sec = document.createElement("span");
                const txt = item.secondary;
                sec.textContent = txt.length > 16 ? "…" + txt.slice(-15) : txt;
                sec.className = "shrink-0 text-xs muted whitespace-nowrap opacity-80";
                rightSide.append(sec);
            }
            rightSide.append(value);
            header.append(name, rightSide);

            row.append(header, track);

            container.appendChild(row);
        });
    }

    segmentsForItem(day, item) {
        if (this.state.activeBreakdown === "projects") {
            return day.timeline.filter(t => t.project === item.project);
        }
        if (this.state.activeBreakdown === "languages") {
            return day.timeline.filter(t => t.language === item.language);
        }
        return day.timeline.filter(t => t.filePath === item.filePath);
    }

    segmentTitle(item) {
        return `${item.project} · ${item.language} · ${item.fileName
            } · ${this.formatDuration(item.durationMs)} `;
    }

    tooltipForBreakdown(item, totalMs) {
        const percent = totalMs > 0 ? Math.round((item.durationMs / totalMs) * 100) : 0;
        const parts = [
            item.label,
            this.formatDuration(item.durationMs),
            percent + "% of visible total"
        ];
        if (item.secondary) { parts.push(item.secondary); }
        if (item.kind === "project" || item.kind === "language") {
            parts.push("Use the edit button to rename this " + item.kind + ".");
        }
        return parts.join("\n");
    }

    labelForBreakdown(key) {
        const labels = {
            projects: "Projects",
            languages: "Languages",
            files: "Files"
        };
        return labels[key] ?? "Projects";
    }

    emptyState(text) {
        const empty = document.createElement("div");
        empty.className = "rounded-lg border border-white/10 p-3 text-sm muted";
        empty.textContent = text;
        return empty;
    }

    dateKeyToLocalMs(dateKey) {
        const parts = dateKey.split("-").map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
    }

    formatDuration(ms) {
        if (ms <= 0) { return "0s"; }
        const totalSeconds = Math.floor(ms / 1000);
        const totalMinutes = Math.floor(totalSeconds / 60);
        if (totalMinutes < 1) { return totalSeconds + "s"; }
        if (totalMinutes < 60) { return totalMinutes + "m"; }
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}h ${String(minutes).padStart(2, "0")} m`;
    }

    formatClock(ms) {
        return new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(ms));
    }

    formatShortDate(ms) {
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric"
        }).format(new Date(ms));
    }

    createTooltip(contentHtml, targetEl) {
        const wrapper = document.createElement("div");
        wrapper.className = "tooltip";

        const content = document.createElement("div");
        content.className = "tooltip-content";
        content.innerHTML = contentHtml;

        wrapper.appendChild(content);
        wrapper.appendChild(targetEl);
        return wrapper;
    }
    mergeHeartbeats(segments, gapThresholdMs = 5 * 60 * 1000) {
        if (!segments || segments.length === 0) { return []; }
        const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
        const merged = [{ ...sorted[0] }];

        for (let i = 1; i < sorted.length; i++) {
            const last = merged[merged.length - 1];
            const curr = sorted[i];
            const gap = curr.startMs - last.endMs;

            if (gap >= 0 && gap < gapThresholdMs) {
                last.endMs = curr.endMs;
                last.durationMs += curr.durationMs;
            } else {
                merged.push({ ...curr });
            }
        }
        return merged;
    }
}

new Dashboard();