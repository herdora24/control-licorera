document.addEventListener('DOMContentLoaded', () => {

    // =========================================================================
    // CONFIGURACIÓN E INICIALIZACIÓN DE FIREBASE
    // =========================================================================
    const firebaseConfig = {
        apiKey: "AIzaSyCm5BGh7cWX4A5fXx8zCN33ztuLvseRhAU",
        authDomain: "control-licorera.firebaseapp.com",
        databaseURL: "https://control-licorera-default-rtdb.firebaseio.com",
        projectId: "control-licorera",
        storageBucket: "control-licorera.appspot.com",
        messagingSenderId: "430925820415",
        appId: "1:430925820415:web:e1c06bc73b6863a5c3f7ca",
        measurementId: "G-86ZY48XKV4"
    };

    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const database = firebase.database();

    // =========================================================================
    // ESTADO GLOBAL Y VARIABLES
    // =========================================================================
    const { jsPDF } = window.jspdf;
    let gastosChart = null;
    let allData = {};
    let dataListeners = [];
    let confirmCallback = null;
    let currentUserProfile = null;
    let selectedBusinessId = null;
    let periods = [];
    let currentPeriod = null;
    
    let historialPeriods = [];
    let selectedHistorialPeriod = null;
    let historialListener = null;

    const dataTypes = ['ingresos', 'compras', 'gastos', 'retiros', 'cuentasPorCobrar', 'cuentasPorPagar', 'vales', 'terceros'];
    
    // =========================================================================
    // FUNCIONES DE UTILIDAD (Declaradas al inicio para evitar errores de inicialización)
    // =========================================================================
    const formatCurrency = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value || 0);
    const getNumericValue = (formattedValue) => {
        if (!formattedValue || typeof formattedValue !== 'string') return 0;
        return parseFloat(formattedValue.replace(/\D/g, '')) || 0;
    };
    const formatDateForInput = (date) => new Date(date).toISOString().split('T')[0];
    const formatInputAsCurrency = (e) => { let input = e.target; let value = input.value.replace(/\D/g, ''); if (value) { const number = parseInt(value, 10); input.value = number.toLocaleString('es-CO'); } else { input.value = ''; } };
    const addCurrencyFormatting = (container) => { container.querySelectorAll('[data-moneda]').forEach(input => { input.removeEventListener('input', formatInputAsCurrency); input.addEventListener('input', formatInputAsCurrency); formatInputAsCurrency({ target: input }); }); };
    const setFormDatesToToday = () => { const today = formatDateForInput(new Date()); ['ingreso-fecha', 'gasto-fecha', 'compra-fecha', 'retiro-fecha'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; }); };

    // =========================================================================
    // RENDERIZADO DE TABLAS Y VISTAS
    // =========================================================================
     const populateTercerosSelects = () => {
        const terceros = allData.terceros || [];
        const empleados = terceros.filter(t => t.tipo === 'empleado').sort((a, b) => a.nombre.localeCompare(b.nombre));
        const clientes = terceros.filter(t => t.tipo === 'cliente').sort((a, b) => a.nombre.localeCompare(b.nombre));
        const proveedores = terceros.filter(t => t.tipo === 'proveedor').sort((a, b) => a.nombre.localeCompare(b.nombre));

        const populate = (selectId, items) => {
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = '<option value="">Seleccione...</option>';
            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = item.nombre;
                select.appendChild(option);
            });
        };
        populate('vale-tercero', empleados);
        populate('cpc-tercero', clientes);
        populate('cpp-tercero', proveedores);
    };

    const renderTercerosTable = () => {
        const table = document.getElementById('tabla-terceros');
        const headers = ['Nombre', 'Tipo', 'Acciones'];
        table.innerHTML = `<thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr>${headers.map(h => `<th class="px-3 sm:px-4 py-3">${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        const data = (allData.terceros || []).sort((a,b) => a.nombre.localeCompare(b.nombre));
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${headers.length}" class="text-center py-4 text-gray-500">No hay terceros creados.</td></tr>`;
            return;
        }

        const rowsHTML = data.map(d => `
            <tr class="bg-white border-b hover:bg-gray-50">
                <td class="px-3 sm:px-4 py-3 font-medium">${d.nombre}</td>
                <td class="px-3 sm:px-4 py-3 capitalize">${d.tipo}</td>
                <td class="px-3 sm:px-4 py-3">
                    <button class="action-button text-red-600 delete-btn" data-type="terceros" data-id="${d.id}"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
        tbody.innerHTML = rowsHTML;
    };

    const renderDeudasConsolidadas = (type, tableId) => {
        const table = document.getElementById(tableId);
        const data = allData[type] || [];
        const terceros = allData.terceros || [];
    
        const personKey = type === 'vales' ? 'Persona' : (type === 'cuentasPorPagar' ? 'Proveedor' : 'Cliente');
        const headers = [personKey, 'Total Deuda', 'Abonado', 'Restante', 'Acciones'];
        table.innerHTML = `<thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr>${headers.map(h => `<th class="px-3 sm:px-4 py-3">${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
    
        const cuentas = new Map();
    
        data.forEach(item => {
            let key, displayName, isLegacy = false;
    
            if (item.terceroId) {
                const tercero = terceros.find(t => t.id === item.terceroId);
                if (!tercero) return; 
                key = item.terceroId;
                displayName = tercero.nombre;
            } else { // Handle legacy data
                displayName = item.cliente || item.acreedor || item.persona;
                if (!displayName) return;
                key = `legacy_${displayName}`;
                isLegacy = true;
            }
    
            if (!cuentas.has(key)) {
                cuentas.set(key, {
                    displayName,
                    totalDeuda: 0,
                    totalAbonado: 0,
                    isLegacy,
                    terceroId: item.terceroId || null
                });
            }
    
            const cuenta = cuentas.get(key);
            cuenta.totalDeuda += item.monto;
            const abonos = item.abonos ? Object.values(item.abonos) : [];
            cuenta.totalAbonado += abonos.reduce((sum, abono) => sum + abono.monto, 0);
        });
    
        if (cuentas.size === 0) {
            tbody.innerHTML = `<tr><td colspan="${headers.length}" class="text-center py-4 text-gray-500">No hay cuentas activas.</td></tr>`;
            return;
        }
    
        let rowsHTML = '';
        cuentas.forEach((cuenta, key) => {
            const restante = cuenta.totalDeuda - cuenta.totalAbonado;
            const isPaid = restante <= 0.01;
            const rowClass = isPaid ? 'bg-gray-100 text-gray-500' : 'bg-white';
            const textStyle = isPaid ? 'line-through' : '';
            
            const actionButtons = `
                <button class="details-btn action-button text-blue-600" data-type="${type}" data-tercero-id="${cuenta.terceroId || ''}" data-legacy-name="${cuenta.isLegacy ? cuenta.displayName : ''}" title="Ver Detalles"><i class="fas fa-eye"></i></button>
                ${!isPaid ? `<button class="abono-btn action-button text-green-600" data-type="${type}" data-tercero-id="${cuenta.terceroId || ''}" data-legacy-name="${cuenta.isLegacy ? cuenta.displayName : ''}" title="Registrar Abono"><i class="fas fa-plus-circle"></i></button>` : ''}
            `;
    
            rowsHTML += `
                <tr class="${rowClass} border-b hover:bg-gray-50">
                    <td class="px-3 sm:px-4 py-3 font-medium ${textStyle}">${cuenta.displayName}</td>
                    <td class="px-3 sm:px-4 py-3 ${textStyle}">${formatCurrency(cuenta.totalDeuda)}</td>
                    <td class="px-3 sm:px-4 py-3 text-green-600 ${textStyle}">${formatCurrency(cuenta.totalAbonado)}</td>
                    <td class="px-3 sm:px-4 py-3 font-bold ${textStyle}">${formatCurrency(restante)}</td>
                    <td class="px-3 sm:px-4 py-3 flex items-center gap-1">${actionButtons}</td>
                </tr>`;
        });
        tbody.innerHTML = rowsHTML;
    };


    const renderTable = (type, tableEl, headers) => { 
        const data = (allData[type] || []).filter(d => d.fecha instanceof Date).sort((a, b) => b.fecha - a.fecha); 
        tableEl.innerHTML = `<thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr>${headers.map(h => `<th class="px-3 sm:px-4 py-3">${h}</th>`).join('')}</tr></thead><tbody></tbody>`; 
        const tbody = tableEl.querySelector('tbody'); 
        if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="${headers.length}" class="text-center py-4 text-gray-500">No hay registros de ${type}.</td></tr>`; return; } 
        const rowsHTML = data.map(item => { 
            let cellsHTML = ''; 
            if (type === 'ingresos') {
                const ventaEfectivo = (item.monto_efectivo || 0) - (item.monto_sobrante || 0);
                cellsHTML = `<td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td><td class="px-3 sm:px-4 py-3">${formatCurrency(ventaEfectivo)}</td><td class="px-3 sm:px-4 py-3" style="color:#e83e8c;">${formatCurrency(item.monto_nequi)}</td><td class="px-3 sm:px-4 py-3">${formatCurrency(item.monto_tarjeta)}</td><td class="px-3 sm:px-4 py-3 text-blue-600 font-medium">${formatCurrency(item.monto_sobrante)}</td><td class="px-3 sm:px-4 py-3 font-bold">${formatCurrency(item.monto)}</td><td class="px-3 sm:px-4 py-3">${item.notas || '-'}</td>`; 
            } else if (type === 'compras') {
                cellsHTML = `<td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td><td class="px-3 sm:px-4 py-3">${item.proveedor}</td><td class="px-3 sm:px-4 py-3">${item.descripcion}</td><td class="px-3 sm:px-4 py-3">${formatCurrency(item.monto)}</td><td class="px-3 sm:px-4 py-3">${item.metodo}</td>`; 
            } else if (type === 'gastos') {
                cellsHTML = `<td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td><td class="px-3 sm:px-4 py-3">${item.descripcion}</td><td class="px-3 sm:px-4 py-3">${item.categoria}</td><td class="px-3 sm:px-4 py-3">${formatCurrency(item.monto)}</td>`; 
            } else if (type === 'retiros') {
                cellsHTML = `<td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td><td class="px-3 sm:px-4 py-3">${item.metodo}</td><td class="px-3 sm:px-4 py-3">${item.descripcion}</td><td class="px-3 sm:px-4 py-3">${formatCurrency(item.monto)}</td>`; 
            }
            cellsHTML += `<td class="px-3 sm:px-4 py-3 flex items-center space-x-2"><button class="action-button text-red-600 delete-btn" data-type="${type}" data-id="${item.id}"><i class="fas fa-trash"></i></button></td>`; 
            return `<tr class="bg-white border-b hover:bg-gray-50">${cellsHTML}</tr>`; 
        }).join(''); 
        tbody.innerHTML = rowsHTML; 
    };
    const renderSobrantesTable = () => {
        const tableEl = document.getElementById('tabla-sobrantes');
        const headers = ['Fecha', 'Monto Sobrante', 'Notas', 'Acciones'];
        const data = (allData.ingresos || [])
            .filter(d => d.monto_sobrante && d.monto_sobrante > 0 && d.fecha instanceof Date)
            .sort((a, b) => b.fecha - a.fecha);

        tableEl.innerHTML = `<thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr>${headers.map(h => `<th class="px-3 sm:px-4 py-3">${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
        const tbody = tableEl.querySelector('tbody');

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${headers.length}" class="text-center py-4 text-gray-500">No hay sobrantes registrados.</td></tr>`;
            return;
        }

        const rowsHTML = data.map(item => {
            const cellsHTML = `
                <td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td>
                <td class="px-3 sm:px-4 py-3 font-medium text-blue-600">${formatCurrency(item.monto_sobrante)}</td>
                <td class="px-3 sm:px-4 py-3">${item.notas || 'Registro de Venta'}</td>
                <td class="px-3 sm:px-4 py-3 flex items-center space-x-2">
                    <button class="action-button text-red-600 delete-btn" data-type="ingresos" data-id="${item.id}" title="Eliminar el registro de ingreso completo"><i class="fas fa-trash"></i></button>
                </td>`;
            return `<tr class="bg-white border-b hover:bg-gray-50">${cellsHTML}</tr>`;
        }).join('');

        tbody.innerHTML = rowsHTML;
    };
    const renderNequiTable = () => {
        const tableEl = document.getElementById('tabla-nequi');
        const headers = ['Fecha', 'Tipo', 'Descripción', 'Entrada', 'Salida'];
        
        const ingresosNequi = (allData.ingresos || [])
            .filter(i => i.monto_nequi && i.monto_nequi > 0)
            .map(i => ({ ...i, tipo: 'Ingreso', entrada: i.monto_nequi, salida: 0, descripcion: i.notas || 'Venta por Nequi' }));
            
        const comprasNequi = (allData.compras || [])
            .filter(c => c.metodo === 'Nequi')
            .map(c => ({ ...c, tipo: 'Compra', entrada: 0, salida: c.monto, descripcion: `${c.proveedor} - ${c.descripcion}` }));

        const retirosNequi = (allData.retiros || [])
            .filter(r => r.metodo === 'Nequi')
            .map(r => ({ ...r, tipo: 'Retiro', entrada: 0, salida: r.monto }));

        const data = [...ingresosNequi, ...comprasNequi, ...retirosNequi]
            .filter(d => d.fecha instanceof Date)
            .sort((a, b) => b.fecha - a.fecha);

        tableEl.innerHTML = `<thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr>${headers.map(h => `<th class="px-3 sm:px-4 py-3">${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
        const tbody = tableEl.querySelector('tbody');

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${headers.length}" class="text-center py-4 text-gray-500">No hay movimientos en Nequi.</td></tr>`;
            return;
        }

        const rowsHTML = data.map(item => {
            const cellsHTML = `
                <td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td>
                <td class="px-3 sm:px-4 py-3">${item.tipo}</td>
                <td class="px-3 sm:px-4 py-3">${item.descripcion}</td>
                <td class="px-3 sm:px-4 py-3 font-medium text-green-600">${item.entrada > 0 ? formatCurrency(item.entrada) : '-'}</td>
                <td class="px-3 sm:px-4 py-3 font-medium text-red-600">${item.salida > 0 ? formatCurrency(item.salida) : '-'}</td>
            `;
            return `<tr class="bg-white border-b hover:bg-gray-50">${cellsHTML}</tr>`;
        }).join('');

        tbody.innerHTML = rowsHTML;
    };
    const renderCuentasPorCobrar = () => { renderDeudasConsolidadas('cuentasPorCobrar', 'tabla-cuentas-cobrar'); };
    const renderCuentasPorPagar = () => { renderDeudasConsolidadas('cuentasPorPagar', 'tabla-cuentas-pagar'); };
    const renderVales = () => { renderDeudasConsolidadas('vales', 'tabla-vales'); };
    const renderAllTables = () => { 
        renderTable('ingresos', document.getElementById('tabla-ingresos'), ['Fecha', 'Venta Efectivo', 'Nequi', 'Banco', 'Sobrante', 'Total Ingreso', 'Notas', 'Acciones']); 
        renderSobrantesTable();
        renderNequiTable();
        renderTable('compras', document.getElementById('tabla-compras'), ['Fecha', 'Proveedor', 'Descripción', 'Monto', 'Pagado con', 'Acciones']); 
        renderTable('gastos', document.getElementById('tabla-gastos'), ['Fecha', 'Descripción', 'Categoría', 'Monto', 'Acciones']); 
        renderTable('retiros', document.getElementById('tabla-retiros'), ['Fecha', 'Retirado de', 'Descripción', 'Monto', 'Acciones']); 
    };

    // =========================================================================
    // LÓGICA DE NAVEGACIÓN
    // =========================================================================
    const changeTab = (tabName) => {
        setFormDatesToToday();
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
        document.getElementById(tabName).classList.remove('hidden');
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`button[data-tab="${tabName}"]`).classList.add('active');

        if (tabName === 'resumen') refreshUI();
        else if (tabName === 'registros') renderAllTables();
        else if (tabName === 'deudas') { populateTercerosSelects(); renderCuentasPorCobrar(); renderCuentasPorPagar(); }
        else if (tabName === 'vales') { populateTercerosSelects(); renderVales(); }
        else if (tabName === 'terceros') renderTercerosTable();
        else if (tabName === 'historial') {
            if (historialPeriods.length === 0) {
                loadHistorialPeriods();
            }
        }
    };

    // =========================================================================
    // LÓGICA DE AUTENTICACIÓN Y SELECCIÓN DE NEGOCIO
    // =========================================================================
    auth.onAuthStateChanged(async user => {
        if (user) {
            const userProfileRef = database.ref(`users/${user.uid}`);
            const snapshot = await userProfileRef.once('value');
            currentUserProfile = snapshot.val();

            if (!currentUserProfile) {
                console.error("No se encontró el perfil del usuario.");
                handleLogout();
                return;
            }

            if (currentUserProfile.role === 'owner') {
                showBusinessSelector();
            } else if (currentUserProfile.role === 'admin' && currentUserProfile.businessId) {
                await selectBusiness(currentUserProfile.businessId);
            } else {
                console.error("Rol de usuario o ID de negocio no definido.");
                showLoginScreen();
            }
            document.getElementById('login-overlay').classList.add('hidden');
        } else {
            showLoginScreen();
        }
    });

    const handleLogout = () => { auth.signOut(); };

    const showLoginScreen = () => {
        document.getElementById('login-overlay').classList.remove('hidden');
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('business-selector-overlay').classList.add('hidden');
        detachAllListeners();
    };
    
    const showBusinessSelector = async () => {
        const businessRef = database.ref('businesses');
        const snapshot = await businessRef.once('value');
        const businesses = snapshot.val();
        const businessListDiv = document.getElementById('business-list');
        businessListDiv.innerHTML = '';

        if (businesses) {
            for (const businessId in businesses) {
                const business = businesses[businessId];
                const button = document.createElement('button');
                button.className = 'w-full text-left p-4 bg-gray-100 hover:bg-indigo-100 rounded-lg transition-colors';
                button.innerHTML = `<span class="font-semibold text-lg text-gray-800">${business.name}</span>`;
                button.onclick = () => selectBusiness(businessId);
                businessListDiv.appendChild(button);
            }
        }

        document.getElementById('business-selector-overlay').classList.remove('hidden');
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('login-overlay').classList.add('hidden');
    };

    const selectBusiness = async (businessId) => {
        selectedBusinessId = businessId;
        
        const businessNameRef = database.ref(`businesses/${businessId}/name`);
        const snapshot = await businessNameRef.once('value');
        const businessName = snapshot.val() || 'Negocio Sin Nombre';
        document.getElementById('app-title').textContent = `📊 Gestión: ${businessName}`;

        const switchBtn = document.getElementById('switch-business-btn');
        if (currentUserProfile.role === 'owner') {
            switchBtn.classList.remove('hidden');
        } else {
            switchBtn.classList.add('hidden');
        }
        
        startDataListeners();
        
        loadHistorialPeriods();
        
        document.getElementById('business-selector-overlay').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        addCurrencyFormatting(document.body);
        changeTab('resumen');
    };

    // =========================================================================
    // LÓGICA DE HISTORIAL
    // =========================================================================
     const loadHistorialPeriods = () => {
        if (historialListener) {
            const prevRef = database.ref(`businesses/${selectedBusinessId}/historial_periodos`);
            prevRef.off('value', historialListener);
        }
        
        const historialRef = database.ref(`businesses/${selectedBusinessId}/historial_periodos`);
        historialListener = historialRef.on('value', (snapshot) => {
            const data = snapshot.val();
            historialPeriods = [];
            
            if (data) {
                Object.entries(data).forEach(([monthKey, periodData]) => {
                    const processedData = {};
                    
                    Object.entries(periodData).forEach(([dataType, items]) => {
                        if (items && typeof items === 'object' && dataType !== 'closedDate' && dataType !== 'notes') {
                            processedData[dataType] = Object.entries(items).map(([id, item]) => ({
                                id,
                                ...item,
                                fecha: item.fecha ? new Date(item.fecha) : new Date()
                            }));
                        }
                    });

                    historialPeriods.push({
                        monthKey,
                        closedDate: periodData.closedDate || '',
                        notes: periodData.notes || '',
                        data: processedData
                    });
                });
                
                historialPeriods.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
            }
            
            renderHistorialPeriods();
        });
    };

    const renderHistorialPeriods = () => {
        const listContainer = document.getElementById('historial-periodos-list');
        
        if (!listContainer) return;

        if (historialPeriods.length === 0) {
            listContainer.innerHTML = `
                <div class="col-span-full text-center py-12 text-gray-500">
                    <i class="fas fa-archive text-6xl text-gray-300 mb-4"></i>
                    <h4 class="text-lg font-medium mb-2">No hay períodos archivados</h4>
                    <p class="text-sm">Los períodos aparecerán aquí después de realizar un corte de mes.</p>
                    <p class="text-xs mt-2 text-gray-400">
                        Utiliza el botón "Corte de Mes" en la pestaña Resumen para archivar un período.
                    </p>
                </div>
            `;
            return;
        }

        const periodsHTML = historialPeriods.map(period => {
            const monthDate = new Date(period.monthKey + '-02T00:00:00');
            const monthName = monthDate.toLocaleDateString('es-CO', { 
                month: 'long', 
                year: 'numeric',
                timeZone: 'UTC'
            });
            const closedDate = new Date(period.closedDate).toLocaleDateString('es-CO');
            
            return `
                <div class="historial-period-card card p-4 border-2 border-gray-200 hover:border-indigo-300 transition-all cursor-pointer ${
                    selectedHistorialPeriod?.monthKey === period.monthKey ? 'selected' : ''
                }" data-month-key="${period.monthKey}">
                    <div class="flex items-center justify-between mb-3">
                        <h4 class="font-semibold text-gray-800 capitalize">${monthName}</h4>
                        <i class="fas fa-archive text-gray-400"></i>
                    </div>
                    <div class="space-y-2 text-sm text-gray-600">
                        <div class="flex items-center">
                            <i class="fas fa-calendar-check w-4 h-4 mr-2 text-green-500"></i>
                            <span>Cerrado: ${closedDate}</span>
                        </div>
                        ${period.notes ? `
                            <div class="flex items-start">
                                <i class="fas fa-sticky-note w-4 h-4 mr-2 mt-0.5 text-yellow-500"></i>
                                <span class="text-xs">${period.notes}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        listContainer.innerHTML = periodsHTML;
    };
    
    const showHistorialPeriodData = (monthKey) => {
        const period = historialPeriods.find(p => p.monthKey === monthKey);
        if (!period) return;

        selectedHistorialPeriod = period;
        
        document.querySelectorAll('.historial-period-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`[data-month-key="${monthKey}"]`).classList.add('selected');

        const totales = {
            ingresos: (period.data.ingresos || []).reduce((sum, item) => sum + item.monto, 0),
            compras: (period.data.compras || []).reduce((sum, item) => sum + item.monto, 0),
            gastos: (period.data.gastos || []).reduce((sum, item) => sum + item.monto, 0),
            retiros: (period.data.retiros || []).reduce((sum, item) => sum + item.monto, 0)
        };

        const monthDate = new Date(period.monthKey + '-02T00:00:00');
        const monthName = monthDate.toLocaleDateString('es-CO', { 
            month: 'long', 
            year: 'numeric',
            timeZone: 'UTC'
        });

        const dataView = document.getElementById('historial-data-view');
        dataView.innerHTML = `
            <div class="historial-data-section border-t pt-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 class="text-xl font-semibold text-gray-800 flex items-center capitalize">
                        <i class="fas fa-eye mr-2 text-indigo-600"></i>
                        Datos de ${monthName}
                    </h3>
                    <button id="close-historial-view" class="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>

                <div class="bg-gray-50 p-4 rounded-lg mb-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <span class="font-medium text-gray-700">Período:</span>
                            <span class="ml-2">${period.monthKey}</span>
                        </div>
                        <div>
                            <span class="font-medium text-gray-700">Fecha de cierre:</span>
                            <span class="ml-2">${new Date(period.closedDate).toLocaleDateString('es-CO')}</span>
                        </div>
                        ${period.notes ? `
                            <div class="md:col-span-2">
                                <span class="font-medium text-gray-700">Notas:</span>
                                <span class="ml-2">${period.notes}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                        <div class="flex items-center">
                            <i class="fas fa-dollar-sign text-2xl text-green-600 mr-3"></i>
                            <div>
                                <h4 class="text-sm font-medium text-green-800">Ingresos Totales</h4>
                                <p class="text-xl font-semibold text-green-600">${formatCurrency(totales.ingresos)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="bg-purple-50 p-4 rounded-lg border border-purple-200">
                        <div class="flex items-center">
                            <i class="fas fa-shopping-cart text-2xl text-purple-600 mr-3"></i>
                            <div>
                                <h4 class="text-sm font-medium text-purple-800">Compras Totales</h4>
                                <p class="text-xl font-semibold text-purple-600">${formatCurrency(totales.compras)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="bg-red-50 p-4 rounded-lg border border-red-200">
                        <div class="flex items-center">
                            <i class="fas fa-receipt text-2xl text-red-600 mr-3"></i>
                            <div>
                                <h4 class="text-sm font-medium text-red-800">Gastos Totales</h4>
                                <p class="text-xl font-semibold text-red-600">${formatCurrency(totales.gastos)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="bg-orange-50 p-4 rounded-lg border border-orange-200">
                        <div class="flex items-center">
                            <i class="fas fa-hand-holding-dollar text-2xl text-orange-600 mr-3"></i>
                            <div>
                                <h4 class="text-sm font-medium text-orange-800">Retiros Totales</h4>
                                <p class="text-xl font-semibold text-orange-600">${formatCurrency(totales.retiros)}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                    ${renderHistorialDataTables(period.data)}
                </div>

                <div class="mt-6 text-center">
                    <button id="download-historial-report" class="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center mx-auto" data-month-key="${period.monthKey}">
                        <i class="fas fa-download mr-2"></i>
                        Descargar Reporte del Período
                    </button>
                </div>
            </div>
        `;

        dataView.classList.remove('hidden');
    };

    const renderHistorialDataTables = (data) => {
        const dataTypeInfo = {
            ingresos: { title: 'Ingresos', icon: 'fas fa-dollar-sign' },
            compras: { title: 'Compras', icon: 'fas fa-shopping-cart' },
            gastos: { title: 'Gastos Operacionales', icon: 'fas fa-receipt' },
            retiros: { title: 'Retiros del Jefe', icon: 'fas fa-hand-holding-dollar' },
            cuentasPorCobrar: { title: 'Cuentas por Cobrar', icon: 'fas fa-users' },
            cuentasPorPagar: { title: 'Cuentas por Pagar', icon: 'fas fa-credit-card' },
            vales: { title: 'Vales de Personal', icon: 'fas fa-user-tag' }
        };

        let tablesHTML = Object.entries(data).map(([dataType, items]) => {
            if (!items || items.length === 0 || !dataTypeInfo[dataType]) return '';
            
            const typeInfo = dataTypeInfo[dataType];
            const limitedItems = items.slice(0, 10);
            
            let headers = `
                <th class="px-4 py-2 text-left">Fecha</th>
                <th class="px-4 py-2 text-left">Descripción</th>
                <th class="px-4 py-2 text-left">Monto</th>
            `;
            if (dataType === 'ingresos') headers += `<th class="px-4 py-2 text-left">Efectivo</th><th class="px-4 py-2 text-left">Nequi</th><th class="px-4 py-2 text-left">Banco</th>`;
            if (dataType === 'compras' || dataType === 'retiros') headers += `<th class="px-4 py-2 text-left">Método</th>`;
            if (dataType === 'gastos') headers += `<th class="px-4 py-2 text-left">Categoría</th>`;

            const bodyRows = limitedItems.map(item => {
                const descripcion = item.descripcion || item.notas || item.proveedor || item.cliente || item.persona || 'N/A';
                let row = `
                    <td class="px-4 py-2">${item.fecha.toLocaleDateString('es-CO')}</td>
                    <td class="px-4 py-2">${descripcion}</td>
                    <td class="px-4 py-2 font-medium">${formatCurrency(item.monto)}</td>
                `;
                if (dataType === 'ingresos') row += `<td class="px-4 py-2 text-green-600">${formatCurrency(item.monto_efectivo || 0)}</td><td class="px-4 py-2" style="color:#e83e8c;">${formatCurrency(item.monto_nequi || 0)}</td><td class="px-4 py-2 text-blue-600">${formatCurrency(item.monto_tarjeta || 0)}</td>`;
                if (dataType === 'compras' || dataType === 'retiros') row += `<td class="px-4 py-2"><span class="px-2 py-1 rounded-full text-xs ${item.metodo === 'Efectivo' ? 'bg-green-100 text-green-800' : (item.metodo === 'Nequi' ? 'text-white' : 'bg-blue-100 text-blue-800')}" style="${item.metodo === 'Nequi' ? 'background-color:#e83e8c;' : ''}"><i class="fas fa-${item.metodo === 'Efectivo' ? 'money-bill' : 'credit-card'} mr-1"></i>${item.metodo}</span></td>`;
                if (dataType === 'gastos') row += `<td class="px-4 py-2"><span class="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs">${item.categoria}</span></td>`;
                return `<tr class="border-b border-gray-200">${row}</tr>`;
            }).join('');

            return `
                <div class="bg-gray-50 p-4 rounded-lg border">
                    <h4 class="text-lg font-medium mb-4 text-gray-800 flex items-center">
                        <i class="${typeInfo.icon} mr-2"></i> ${typeInfo.title}
                        <span class="ml-2 text-sm font-normal text-gray-500">(${items.length} registros)</span>
                    </h4>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100"><tr>${headers}</tr></thead>
                            <tbody>${bodyRows}</tbody>
                        </table>
                        ${items.length > 10 ? `<div class="text-center text-gray-500 mt-3 p-2 bg-gray-100 rounded">... y ${items.length - 10} registros más</div>` : ''}
                    </div>
                </div>
            `;
        }).filter(html => html !== '').join('');

        const sobrantesData = (data.ingresos || []).filter(i => i.monto_sobrante && i.monto_sobrante > 0);
        if (sobrantesData.length > 0) {
            tablesHTML += `
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h4 class="text-lg font-medium mb-4 text-blue-800 flex items-center">
                        <i class="fas fa-coins mr-2"></i> Sobrantes del Día
                        <span class="ml-2 text-sm font-normal text-gray-500">(${sobrantesData.length} registros)</span>
                    </h4>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-blue-100">
                                <tr>
                                    <th class="px-4 py-2 text-left">Fecha</th>
                                    <th class="px-4 py-2 text-left">Monto Sobrante</th>
                                    <th class="px-4 py-2 text-left">Notas</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sobrantesData.slice(0, 10).map(item => `
                                    <tr class="border-b border-blue-200">
                                        <td class="px-4 py-2">${item.fecha.toLocaleDateString('es-CO')}</td>
                                        <td class="px-4 py-2 font-medium text-blue-600">${formatCurrency(item.monto_sobrante)}</td>
                                        <td class="px-4 py-2">${item.notas || 'Registro de Venta'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        ${sobrantesData.length > 10 ? `<div class="text-center text-gray-500 mt-3 p-2 bg-gray-100 rounded">... y ${sobrantesData.length - 10} registros más</div>` : ''}
                    </div>
                </div>
            `;
        }
        return tablesHTML;
    };

    // =========================================================================
    // MANEJO DE DATOS Y PERÍODOS
    // =========================================================================
    const detachAllListeners = () => {
        dataListeners.forEach(({ ref, listener }) => ref.off('value', listener));
        dataListeners = [];
        
        if (historialListener && selectedBusinessId) {
            const historialRef = database.ref(`businesses/${selectedBusinessId}/historial_periodos`);
            historialRef.off('value', historialListener);
            historialListener = null;
        }
    };

    const startDataListeners = () => {
        detachAllListeners();
        allData = {};
        
        const periodsRef = database.ref(`businesses/${selectedBusinessId}/periods`);
        const periodsListener = periodsRef.on('value', async (snapshot) => {
            if (!snapshot.exists()) {
                const now = new Date();
                const initialPeriod = { 
                    startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), 
                    endDate: null, 
                    monthKey: now.toISOString().slice(0, 7),
                    isClosed: false
                };
                await periodsRef.push(initialPeriod);
            } else {
                periods = firebaseObjectToArray(snapshot);
                determineActivePeriod();
            }
        });
        dataListeners.push({ ref: periodsRef, listener: periodsListener });

        dataTypes.forEach(type => {
            const ref = database.ref(`businesses/${selectedBusinessId}/${type}`);
            const listener = ref.on('value', snapshot => {
                allData[type] = firebaseObjectToArray(snapshot);
                if (type === 'terceros') {
                    populateTercerosSelects();
                }
                if (currentPeriod) {
                    refreshUI();
                }
            });
            dataListeners.push({ ref, listener });
        });
    };

    const determineActivePeriod = () => {
        const openPeriods = periods
            .filter(p => !p.isClosed)
            .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

        if (openPeriods.length > 0) {
            currentPeriod = openPeriods[0];
        } else {
            currentPeriod = periods.sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0];
        }

        if (currentPeriod) {
            document.getElementById('month-filter').value = currentPeriod.monthKey;
            refreshUI();
        } else {
            console.error("No se pudo determinar un período activo.");
        }
    };

    const updatePeriodStatus = () => {
        const statusEl = document.getElementById('period-status');
        const closePeriodBtn = document.getElementById('close-period-btn');
        const monthFilterValue = document.getElementById('month-filter').value;
        
        const displayedPeriod = periods.find(p => p.monthKey === monthFilterValue);

        if (displayedPeriod && displayedPeriod.isClosed) {
            statusEl.classList.remove('hidden');
            statusEl.className = 'mt-2 px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-red-100 text-red-800 locked-indicator';
            closePeriodBtn.disabled = true;
            closePeriodBtn.classList.add('opacity-50', 'cursor-not-allowed');
            closePeriodBtn.innerHTML = '<i class="fas fa-lock mr-1 sm:mr-2"></i>Período Cerrado';
        } else {
            statusEl.classList.add('hidden');
            closePeriodBtn.disabled = false;
            closePeriodBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            closePeriodBtn.innerHTML = '<i class="fas fa-calendar-check mr-1 sm:mr-2"></i><span class="hidden sm:inline">Realizar </span>Corte de Mes';
        }
    };

    const isPeriodClosed = (monthKey) => {
        const period = periods.find(p => p.monthKey === monthKey);
        return period && period.isClosed;
    };

    const validatePeriodAccess = (itemMonthKey) => {
        if (isPeriodClosed(itemMonthKey)) {
            showNotification('Período Cerrado', `No se pueden realizar modificaciones en el período ${itemMonthKey} porque ya está cerrado.`, 'error');
            return false;
        }
        return true;
    };
    
    const firebaseObjectToArray = (snapshot) => {
        const data = [];
        if (snapshot.exists()) {
            snapshot.forEach(childSnapshot => {
                const item = childSnapshot.val();
                if (typeof item !== 'object' || item === null) return;
                if (item.fecha && typeof item.fecha === 'string') {
                    const dateObj = new Date(item.fecha);
                    if (!isNaN(dateObj)) {
                        item.fecha = dateObj;
                    } else {
                        console.warn('Fecha inválida encontrada:', item.fecha);
                        item.fecha = new Date();
                    }
                }
                if(item.abonos && typeof item.abonos === 'object') {
                    item.abonos = Object.values(item.abonos).map(abono => {
                        if (abono.fecha && typeof abono.fecha === 'string') return {...abono, fecha: new Date(abono.fecha)};
                        return abono;
                    });
                }
                data.push({ id: childSnapshot.key, ...item });
            });
        }
        return data;
    };

    const refreshUI = () => { 
        filterAndRenderDashboard(); 
        const activeTabName = document.querySelector('.tab-button.active')?.dataset.tab;
        if (activeTabName === 'registros') renderAllTables();
        else if (activeTabName === 'deudas') { renderCuentasPorCobrar(); renderCuentasPorPagar(); }
        else if (activeTabName === 'vales') renderVales();
        else if (activeTabName === 'terceros') renderTercerosTable();

    };
    
    const filterAndRenderDashboard = () => {
        const filterValue = document.getElementById('month-filter').value;
        if (!filterValue || Object.keys(allData).length === 0) { 
            updateDashboard({}, {}); 
            return; 
        }
        
        const periodDisplayDate = new Date(filterValue + '-02T00:00:00Z');
        document.getElementById('period-display').textContent = `Mostrando datos para: ${periodDisplayDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
        
        updatePeriodStatus();
        
        const periodData = {};
        const [year, month] = filterValue.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(year, month, 1);
        endDate.setHours(0, 0, 0, 0);

        ['ingresos', 'compras', 'gastos', 'retiros'].forEach(key => {
            periodData[key] = (allData[key] || []).filter(d => {
                if (d.monthKey) return d.monthKey === filterValue;
                return d.fecha && d.fecha >= startDate && d.fecha < endDate;
            });
        });
        updateDashboard(periodData, allData);
    };

    const updateDashboard = (periodData, globalData) => {
        const totalIngresosMes = (periodData.ingresos || []).reduce((sum, item) => sum + item.monto, 0);
        const totalComprasMes = (periodData.compras || []).reduce((sum, item) => sum + item.monto, 0);
        const totalGastosOpMes = (periodData.gastos || []).reduce((sum, item) => sum + item.monto, 0);
        const totalRetirosMes = (periodData.retiros || []).reduce((sum, item) => sum + item.monto, 0);

        const { efectivo, banco, nequi } = calculateCurrentBalances();
        
        const totalCPC = (globalData.cuentasPorCobrar || []).reduce((sum, d) => sum + (d.monto - (Object.values(d.abonos || {})).reduce((s, a) => s + a.monto, 0)), 0);
        const totalCPP = (globalData.cuentasPorPagar || []).filter(d => d.estado !== 'Pagada').reduce((sum, d) => sum + d.monto - (Object.values(d.abonos || {})).reduce((s, a) => s + a.monto, 0), 0);
        
        document.getElementById('total-ingresos').textContent = formatCurrency(totalIngresosMes);
        document.getElementById('total-compras').textContent = formatCurrency(totalComprasMes);
        document.getElementById('total-gastos-op').textContent = formatCurrency(totalGastosOpMes);
        document.getElementById('total-retiros').textContent = formatCurrency(totalRetirosMes);
        document.getElementById('efectivo-caja').textContent = formatCurrency(efectivo);
        document.getElementById('saldo-banco').textContent = formatCurrency(banco);
        document.getElementById('saldo-nequi').textContent = formatCurrency(nequi);
        document.getElementById('cuentas-cobrar-total').textContent = formatCurrency(totalCPC);
        document.getElementById('cuentas-pagar-total').textContent = formatCurrency(totalCPP);

        const allMovements = [...(globalData.ingresos || []), ...(globalData.compras || []), ...(globalData.gastos || []), ...(globalData.retiros || [])].filter(mov => mov.fecha instanceof Date).sort((a,b) => b.fecha - a.fecha).slice(0, 10);
        const tbody = document.getElementById('ultimos-movimientos-body');
        tbody.innerHTML = allMovements.length === 0 ? `<tr><td colspan="3" class="text-center py-4 text-gray-500">No hay movimientos.</td></tr>` : '';
        allMovements.forEach(mov => {
            const tr = document.createElement('tr'); tr.className = 'bg-white border-b';
            const type = mov.monto_efectivo !== undefined ? 'ingreso' : (mov.proveedor !== undefined ? 'compra' : (mov.categoria !== undefined ? 'gasto' : 'retiro'));
            const desc = mov.notas || mov.descripcion || mov.proveedor || `Venta del día`;
            const montoClass = type === 'ingreso' ? 'text-green-600' : (type === 'compra' ? 'text-purple-600' : (type === 'gasto' ? 'text-red-600' : 'text-orange-500'));
            tr.innerHTML = `<td class="px-3 sm:px-6 py-4">${mov.fecha.toLocaleDateString()}</td><td class="px-3 sm:px-6 py-4">${desc}</td><td class="px-3 sm:px-6 py-4 font-medium ${montoClass}">${formatCurrency(mov.monto)}</td>`;
            tbody.appendChild(tr);
        });
        updateGastosChart(periodData.gastos);
    };

    const updateGastosChart = (gastos) => {
        const ctx = document.getElementById('gastos-chart').getContext('2d');
        if (gastosChart) gastosChart.destroy();
        const dataPorCategoria = (gastos || []).reduce((acc, gasto) => { acc[gasto.categoria] = (acc[gasto.categoria] || 0) + gasto.monto; return acc; }, {});
        if (Object.keys(dataPorCategoria).length === 0) { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#6b7280'; ctx.font = "16px 'Inter'"; ctx.fillText("No hay gastos para mostrar.", ctx.canvas.width / 2, ctx.canvas.height / 2); ctx.restore(); return; }
        gastosChart = new Chart(ctx, { type: 'pie', data: { labels: Object.keys(dataPorCategoria), datasets: [{ data: Object.values(dataPorCategoria), backgroundColor: ['#ef4444', '#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#f59e0b', '#ec4899', '#6366f1', '#84cc16'], hoverOffset: 4 }] }, options: { responsive: true, plugins: { legend: { position: 'top' }}} });
    };

    // =========================================================================
    // FUNCIONES DE CORTE DE MES
    // =========================================================================
    const initializeCorteModal = () => {
        const today = new Date();
        const activePeriodKey = document.getElementById('month-filter').value;
        document.getElementById('corte-periodo').value = activePeriodKey;
        document.getElementById('corte-fecha').value = today.toISOString().slice(0, 10);
        showCorteStep(1);
    };

    const showCorteStep = (step) => {
        document.querySelectorAll('.corte-step').forEach(el => el.classList.add('hidden'));
        document.getElementById(`corte-step-${step}`).classList.remove('hidden');
    };

    const generateCortePreview = () => {
        const periodo = document.getElementById('corte-periodo').value;
        
        const periodToClose = periods.find(p => p.monthKey === periodo);
        if (periodToClose && periodToClose.isClosed) {
            showNotification('Error', `El período ${periodo} ya está cerrado y no se puede volver a procesar.`, 'error');
            showCorteStep(1);
            return;
        }

        const periodData = {};
        dataTypes.forEach(type => {
            periodData[type] = (allData[type] || []).filter(d => d.monthKey === periodo);
        });

        const totales = {
            ingresos: periodData.ingresos.reduce((sum, item) => sum + item.monto, 0),
            compras: periodData.compras.reduce((sum, item) => sum + item.monto, 0),
            gastos: periodData.gastos.reduce((sum, item) => sum + item.monto, 0),
            retiros: periodData.retiros.reduce((sum, item) => sum + item.monto, 0)
        };

        const saldos = calculateCurrentBalances();

        const cuentasPendientes = {
            porCobrar: (allData.cuentasPorCobrar || []).filter(d => (d.monto - (d.abonos || []).reduce((s, a) => s + a.monto, 0)) > 0),
            porPagar: (allData.cuentasPorPagar || []).filter(d => d.estado !== 'Pagada'),
            vales: (allData.vales || []).filter(d => (d.monto - (d.abonos || []).reduce((s, a) => s + a.monto, 0)) > 0)
        };

        const previewContent = document.getElementById('corte-preview-content');
        previewContent.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                 <div class="space-y-4">
                     <h5 class="font-semibold text-gray-800 border-b pb-2">Resumen del Período a Cerrar (${periodo})</h5>
                     <div class="space-y-2 text-sm">
                         <div class="flex justify-between"><span>Total Ingresos:</span><span class="font-medium text-green-600">${formatCurrency(totales.ingresos)}</span></div>
                         <div class="flex justify-between"><span>Total Compras:</span><span class="font-medium text-purple-600">${formatCurrency(totales.compras)}</span></div>
                         <div class="flex justify-between"><span>Total Gastos:</span><span class="font-medium text-red-600">${formatCurrency(totales.gastos)}</span></div>
                         <div class="flex justify-between"><span>Total Retiros:</span><span class="font-medium text-orange-600">${formatCurrency(totales.retiros)}</span></div>
                     </div>
                 </div>
                 <div class="space-y-4">
                    <h5 class="font-semibold text-gray-800 border-b pb-2">Saldos Actuales (Global)</h5>
                     <div class="space-y-2 text-sm">
                         <div class="flex justify-between"><span>Efectivo en Caja:</span><span class="font-medium text-blue-600">${formatCurrency(saldos.efectivo)}</span></div>
                         <div class="flex justify-between"><span>Saldo en Nequi:</span><span class="font-medium" style="color: #e83e8c;">${formatCurrency(saldos.nequi)}</span></div>
                         <div class="flex justify-between"><span>Saldo en Banco:</span><span class="font-medium text-green-600">${formatCurrency(saldos.banco)}</span></div>
                         <div class="flex justify-between pt-2 border-t"><span>Cuentas por Cobrar Pendientes:</span><span class="font-medium">${cuentasPendientes.porCobrar.length}</span></div>
                         <div class="flex justify-between"><span>Cuentas por Pagar Pendientes:</span><span class="font-medium">${cuentasPendientes.porPagar.length}</span></div>
                         <div class="flex justify-between"><span>Vales Pendientes:</span><span class="font-medium">${cuentasPendientes.vales.length}</span></div>
                    </div>
                 </div>
            </div>
            <div class="mt-4 sm:mt-6 p-4 bg-yellow-50 border border-yellow-300 rounded-lg">
                <h5 class="font-semibold text-yellow-800 mb-2">¡Atención! Proceso de Archivado</h5>
                <ul class="text-sm text-yellow-700 space-y-1 list-disc list-inside">
                    <li>El período <strong>${periodo}</strong> se marcará como <strong>CERRADO</strong>.</li>
                    <li>Todos los registros (ingresos, gastos, etc.) de este período se <strong>ARCHIVARÁN</strong> permanentemente. ¡No se borrará información!</li>
                    <li>Las deudas y vales con saldo pendiente <strong>permanecerán activos</strong> para el siguiente mes.</li>
                    <li><strong>IMPORTANTE:</strong> Este proceso es irreversible.</li>
                </ul>
            </div>
        `;
        showCorteStep(2);
    };

    const calculateCurrentBalances = () => {
        const totalIngresosEfectivo = (allData.ingresos || []).reduce((sum, i) => sum + (i.monto_efectivo || 0), 0);
        const totalIngresosNequi = (allData.ingresos || []).reduce((sum, i) => sum + (i.monto_nequi || 0), 0);
        const totalIngresosBanco = (allData.ingresos || []).reduce((sum, i) => sum + (i.monto_tarjeta || 0), 0);
        
        const totalComprasEfectivo = (allData.compras || []).filter(c => c.metodo === 'Efectivo').reduce((sum, c) => sum + c.monto, 0);
        const totalComprasNequi = (allData.compras || []).filter(c => c.metodo === 'Nequi').reduce((sum, c) => sum + c.monto, 0);
        const totalComprasBanco = (allData.compras || []).filter(c => c.metodo === 'Banco').reduce((sum, c) => sum + c.monto, 0);
        
        const totalGastosOp = (allData.gastos || []).reduce((sum, g) => sum + g.monto, 0);
        
        const totalRetirosEfectivo = (allData.retiros || []).filter(r => r.metodo === 'Efectivo').reduce((sum, r) => sum + r.monto, 0);
        const totalRetirosNequi = (allData.retiros || []).filter(r => r.metodo === 'Nequi').reduce((sum, r) => sum + r.monto, 0);
        const totalRetirosBanco = (allData.retiros || []).filter(r => r.metodo === 'Banco').reduce((sum, r) => sum + r.monto, 0);
        
        return {
            efectivo: totalIngresosEfectivo - totalComprasEfectivo - totalGastosOp - totalRetirosEfectivo,
            nequi: totalIngresosNequi - totalComprasNequi - totalRetirosNequi,
            banco: totalIngresosBanco - totalComprasBanco - totalRetirosBanco
        };
    };

    const executeCorte = async () => {
        const periodo = document.getElementById('corte-periodo').value;
        const fechaCorte = document.getElementById('corte-fecha').value;
        const notas = document.getElementById('corte-notas').value;

        showCorteStep(3);

        const steps = [
            'Recopilando datos del período...',
            'Archivando transacciones...',
            'Eliminando registros del período cerrado...',
            'Marcando período como cerrado y creando el nuevo...'
        ];

        const stepsList = document.getElementById('corte-steps-list');
        const progressBar = document.getElementById('corte-progress-bar');
        const progressText = document.getElementById('corte-progress-text');
        stepsList.innerHTML = '';
        
        let finalSummary = {};

        try {
            const updates = {};
            
            for (let i = 0; i < steps.length; i++) {
                progressText.textContent = `Paso ${i + 1} de ${steps.length}: ${steps[i]}`;
                const stepEl = document.createElement('div');
                stepEl.className = 'flex items-center text-sm slide-in text-gray-500';
                stepEl.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i><span>${steps[i]}</span>`;
                stepsList.appendChild(stepEl);

                switch (i) {
                    case 0: // Recopilar datos
                        const periodTransactions = {};
                        const typesToArchive = ['ingresos', 'compras', 'gastos', 'retiros'];
                        
                        const [year, month] = periodo.split('-').map(Number);
                        const startDate = new Date(year, month - 1, 1);
                        startDate.setHours(0, 0, 0, 0);
                        const endDate = new Date(year, month, 1);
                        endDate.setHours(0, 0, 0, 0);

                        typesToArchive.forEach(type => {
                            periodTransactions[type] = (allData[type] || []).filter(d => {
                                if (d.monthKey) {
                                    return d.monthKey === periodo;
                                }
                                return d.fecha && d.fecha >= startDate && d.fecha < endDate;
                            });
                        });
                       
                        updates['periodTransactions'] = periodTransactions;
                        await new Promise(res => setTimeout(res, 100));
                        break;
                    
                    case 1: // Archivar transacciones
                        const historialPath = `businesses/${selectedBusinessId}/historial_periodos/${periodo}`;
                        updates[`${historialPath}/closedDate`] = new Date(fechaCorte).toISOString();
                        updates[`${historialPath}/notes`] = notas;

                        const { periodTransactions: transactions } = updates;
                        for (const type in transactions) {
                            if (transactions[type].length > 0) {
                                transactions[type].forEach(item => {
                                    const { id, ...rest } = item;
                                    updates[`${historialPath}/${type}/${id}`] = rest;
                                });
                            }
                        }
                        break;

                    case 2: // Eliminar registros del período cerrado
                        const { periodTransactions: transactionsToDelete } = updates;
                        for (const type in transactionsToDelete) {
                            if (transactionsToDelete[type].length > 0) {
                                transactionsToDelete[type].forEach(item => {
                                    updates[`businesses/${selectedBusinessId}/${type}/${item.id}`] = null;
                                });
                            }
                        }
                        delete updates.periodTransactions;
                        break;

                    case 3: // Marcar período y crear nuevo
                        const periodToClose = periods.find(p => p.monthKey === periodo);
                        if (periodToClose) {
                            updates[`businesses/${selectedBusinessId}/periods/${periodToClose.id}/isClosed`] = true;
                            updates[`businesses/${selectedBusinessId}/periods/${periodToClose.id}/endDate`] = new Date(fechaCorte).toISOString();
                        }
                        
                        const nextMonth = getNextMonth(periodo);
                        const existingNextPeriod = periods.find(p => p.monthKey === nextMonth);
                        
                        if (!existingNextPeriod) {
                            const [nextYear, nextMonthNum] = nextMonth.split('-').map(Number);
                            const newPeriod = {
                                startDate: new Date(nextYear, nextMonthNum - 1, 1).toISOString(),
                                endDate: null,
                                monthKey: nextMonth,
                                isClosed: false,
                                createdFrom: periodo
                            };
                            const newPeriodKey = database.ref().child(`businesses/${selectedBusinessId}/periods`).push().key;
                            updates[`businesses/${selectedBusinessId}/periods/${newPeriodKey}`] = newPeriod;
                            finalSummary.newPeriod = nextMonth;
                        } else {
                            finalSummary.newPeriod = `ya existente (${nextMonth})`;
                        }
                        finalSummary.closedPeriod = periodo;
                        break;
                }

                stepEl.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-2"></i><span class="text-gray-800">${steps[i]}</span>`;
                progressBar.style.width = `${((i + 1) / steps.length) * 100}%`;
            }

            await database.ref().update(updates);
            
            showCorteStep(4);
            generateCorteSummary(finalSummary);

        } catch (error) {
            console.error('Error en el corte:', error);
            showNotification('Error', 'Ocurrió un error durante el archivado: ' + error.message, 'error');
            showCorteStep(1);
        }
    };

    const getNextMonth = (currentMonth) => {
        const [year, month] = currentMonth.split('-').map(Number);
        const nextDate = new Date(year, month, 1);
        return nextDate.toISOString().slice(0, 7);
    };

    const generateCorteSummary = (summary) => {
        const summaryEl = document.getElementById('corte-summary');
        
        summaryEl.innerHTML = `
            <div class="text-center">
                <h5 class="font-semibold text-green-800 mb-4">Proceso de Cierre Completado</h5>
                <div class="space-y-2 text-sm">
                    <p><strong>Período cerrado y archivado:</strong> ${summary.closedPeriod}</p>
                    <p><strong>Nuevo período activo:</strong> ${summary.newPeriod}</p>
                    <p class="text-green-700 font-medium mt-4">✅ La información del período cerrado se ha guardado en el historial.</p>
                </div>
            </div>
        `;
    };

    const generateCorteReport = () => { showNotification('Función en desarrollo', 'La descarga del reporte de corte estará disponible pronto.', 'success'); };

    // =========================================================================
    // EVENT LISTENERS (UI)
    // =========================================================================
    document.body.addEventListener('click', (e) => {
        const periodCard = e.target.closest('.historial-period-card');
        if (periodCard) {
            showHistorialPeriodData(periodCard.dataset.monthKey);
            return;
        }
        if (e.target.closest('#close-historial-view')) {
            document.getElementById('historial-data-view').classList.add('hidden');
            selectedHistorialPeriod = null;
            document.querySelectorAll('.historial-period-card').forEach(card => card.classList.remove('selected'));
            return;
        }
        if (e.target.closest('#refresh-historial-btn')) {
            loadHistorialPeriods();
            showNotification('Éxito', 'Historial actualizado correctamente.');
            return;
        }
        if (e.target.closest('#download-historial-report')) {
            generateHistorialReport(e.target.closest('#download-historial-report').dataset.monthKey);
            return;
        }

        const target = e.target;
        const deleteBtn = target.closest('.delete-btn');
        const pdfBtn = target.closest('.btn-pdf');
        const tabBtn = target.closest('.tab-button');
        const abonoBtn = target.closest('.abono-btn');
        const pagarBtn = target.closest('.pagar-btn');
        const detailsBtn = target.closest('.details-btn');

        if (tabBtn) changeTab(tabBtn.dataset.tab);
        else if (deleteBtn) {
            const item = (allData[deleteBtn.dataset.type] || []).find(i => i.id === deleteBtn.dataset.id);
            if (item) {
                 handleDelete(deleteBtn.dataset.type, deleteBtn.dataset.id, item.monthKey);
            }
        }
        else if (pdfBtn) {
            const type = pdfBtn.dataset.type;
            if (type === 'deudas-cobrar') exportDeudasPDF('cuentasPorCobrar');
            else if (type === 'deudas-pagar') exportDeudasPDF('cuentasPorPagar');
            else if (type === 'vales') exportDeudasPDF('vales');
            else if (type === 'sobrantes') exportSobrantesPDF();
            else if (type === 'nequi') exportNequiPDF();
            else exportToPDF(type);
        }
        else if (abonoBtn) {
             handleAbonar(abonoBtn.dataset.terceroId, abonoBtn.dataset.type, abonoBtn.dataset.legacyName);
        }
        else if (pagarBtn) handlePagar(pagarBtn.dataset.id);
        else if (detailsBtn) handleTerceroDetails(detailsBtn.dataset.terceroId, detailsBtn.dataset.type, detailsBtn.dataset.legacyName);
    });

    document.getElementById('close-period-btn').addEventListener('click', () => {
        const activePeriodKey = document.getElementById('month-filter').value;
        if (isPeriodClosed(activePeriodKey)) {
            showNotification('Período Cerrado', 'Este período ya ha sido cerrado.', 'error');
            return;
        }
        initializeCorteModal();
        document.getElementById('corte-mes-modal').style.display = 'flex';
    });
    
    const closeCorteModalAndReload = () => {
        document.getElementById('corte-mes-modal').style.display = 'none';
    };

    document.getElementById('close-corte-modal-btn').addEventListener('click', closeCorteModalAndReload);
    document.getElementById('corte-next-step1').addEventListener('click', generateCortePreview);
    document.getElementById('corte-back-step2').addEventListener('click', () => { showCorteStep(1); });
    document.getElementById('corte-confirm').addEventListener('click', () => { executeCorte(); });
    document.getElementById('corte-download-report').addEventListener('click', generateCorteReport);
    document.getElementById('corte-close-modal-final').addEventListener('click', closeCorteModalAndReload);
    
    document.getElementById('btn-nuevo-cpc').addEventListener('click', () => { changeTab('terceros'); document.getElementById('tercero-tipo').value = 'cliente'; });
    document.getElementById('btn-nuevo-cpp').addEventListener('click', () => { changeTab('terceros'); document.getElementById('tercero-tipo').value = 'proveedor'; });
    document.getElementById('btn-nuevo-vale').addEventListener('click', () => { changeTab('terceros'); document.getElementById('tercero-tipo').value = 'empleado'; });
    document.getElementById('cancel-tercero-details-btn').onclick = () => document.getElementById('tercero-details-modal').style.display = 'none';


    const getRefFor = (type) => database.ref(`businesses/${selectedBusinessId}/${type}`);

    // =========================================================================
    // LÓGICA DE GUARDADO
    // =========================================================================
    const getTimestampFromDateInput = (dateInputId) => {
        const dateValue = document.getElementById(dateInputId).value;
        const now = new Date();
        const [year, month, day] = dateValue.split('-').map(Number);
        return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
    };

    const addTransaction = (type, data) => {
        if (!currentPeriod || currentPeriod.isClosed) {
            showNotification('Error', 'No hay un período contable activo y abierto para registrar transacciones.', 'error');
            return false;
        }
        const newData = { ...data, monthKey: currentPeriod.monthKey };
        getRefFor(type).push(newData);
        return true;
    };

    document.getElementById('form-ingresos').addEventListener('submit', (e) => { 
        e.preventDefault(); 
        const fecha = getTimestampFromDateInput('ingreso-fecha');
        const ventasEfectivo = getNumericValue(document.getElementById('ingreso-efectivo').value); 
        const ventasNequi = getNumericValue(document.getElementById('ingreso-nequi').value);
        const ventasTarjeta = getNumericValue(document.getElementById('ingreso-tarjeta').value); 
        const sobrante = getNumericValue(document.getElementById('ingreso-sobrante').value);
        const totalEfectivoConSobrante = ventasEfectivo + sobrante;
        const totalIngreso = totalEfectivoConSobrante + ventasNequi + ventasTarjeta;

        const success = addTransaction('ingresos', { 
            fecha: fecha, 
            monto: totalIngreso, 
            monto_efectivo: totalEfectivoConSobrante, 
            monto_nequi: ventasNequi,
            monto_tarjeta: ventasTarjeta, 
            monto_sobrante: sobrante,
            notas: document.getElementById('ingreso-notas').value 
        }); 

        if (success) {
            showNotification('Éxito', 'Ingreso registrado.'); 
            e.target.reset(); 
            addCurrencyFormatting(e.target); 
            changeTab('resumen'); 
        }
    });

    document.getElementById('form-compras').addEventListener('submit', (e) => { 
        e.preventDefault(); 
        const success = addTransaction('compras', { 
            fecha: getTimestampFromDateInput('compra-fecha'), 
            proveedor: document.getElementById('compra-proveedor').value, 
            descripcion: document.getElementById('compra-descripcion').value, 
            monto: getNumericValue(document.getElementById('compra-monto').value), 
            metodo: document.getElementById('compra-metodo').value 
        }); 
        if (success) {
            showNotification('Éxito', 'Compra registrada.'); 
            e.target.reset(); 
            addCurrencyFormatting(e.target); 
            changeTab('resumen'); 
        }
    });

    document.getElementById('form-gastos').addEventListener('submit', (e) => { 
        e.preventDefault(); 
        const success = addTransaction('gastos', { 
            fecha: getTimestampFromDateInput('gasto-fecha'), 
            descripcion: document.getElementById('gasto-descripcion').value, 
            categoria: document.getElementById('gasto-categoria').value, 
            monto: getNumericValue(document.getElementById('gasto-monto').value) 
        }); 
        if (success) {
            showNotification('Éxito', 'Gasto registrado.'); 
            e.target.reset(); 
            addCurrencyFormatting(e.target); 
            changeTab('resumen'); 
        }
    });

    document.getElementById('form-retiros').addEventListener('submit', (e) => { 
        e.preventDefault(); 
        const success = addTransaction('retiros', { 
            fecha: getTimestampFromDateInput('retiro-fecha'), 
            metodo: document.getElementById('retiro-metodo').value, 
            descripcion: document.getElementById('retiro-descripcion').value, 
            monto: getNumericValue(document.getElementById('retiro-monto').value) 
        }); 
        if (success) {
            showNotification('Éxito', 'Retiro registrado.'); 
            e.target.reset(); 
            addCurrencyFormatting(e.target); 
            changeTab('resumen'); 
        }
    });

    document.getElementById('form-cuentas-cobrar').addEventListener('submit', (e) => {
        e.preventDefault();
        const terceroId = document.getElementById('cpc-tercero').value;
        if (!terceroId) {
            showNotification('Error', 'Debe seleccionar un cliente válido.', 'error');
            return;
        }

        const success = addTransaction('cuentasPorCobrar', {
            fecha: new Date().toISOString(),
            terceroId: terceroId,
            descripcion: document.getElementById('cpc-descripcion').value,
            monto: getNumericValue(document.getElementById('cpc-monto').value),
            abonos: {}
        });
        if (success) {
            showNotification('Éxito', 'Deuda por cobrar registrada.');
            e.target.reset();
            addCurrencyFormatting(e.target);
        }
    });

    document.getElementById('form-cuentas-pagar').addEventListener('submit', (e) => {
        e.preventDefault();
        const terceroId = document.getElementById('cpp-tercero').value;
        if (!terceroId) {
            showNotification('Error', 'Debe seleccionar un proveedor válido.', 'error');
            return;
        }
        const success = addTransaction('cuentasPorPagar', {
            fecha: new Date().toISOString(),
            terceroId: terceroId,
            descripcion: document.getElementById('cpp-descripcion').value,
            monto: getNumericValue(document.getElementById('cpp-monto').value),
            estado: 'Pendiente'
        });
        if (success) {
            showNotification('Éxito', 'Cuenta por pagar registrada.');
            e.target.reset();
            addCurrencyFormatting(e.target);
        }
    });

    document.getElementById('form-vales').addEventListener('submit', (e) => {
        e.preventDefault();
        const terceroId = document.getElementById('vale-tercero').value;
        const tercero = allData.terceros.find(t => t.id === terceroId);
        if (!tercero) {
            showNotification('Error', 'Debe seleccionar un empleado válido.', 'error');
            return;
        }
        const monto = getNumericValue(document.getElementById('vale-monto').value);
        const descripcion = document.getElementById('vale-descripcion').value;
        const nowISO = new Date().toISOString();

        const successVale = addTransaction('vales', {
            fecha: nowISO,
            terceroId: terceroId,
            descripcion: descripcion,
            monto: monto,
            abonos: {}
        });
        
        if (successVale) {
            // Registrar el vale como un gasto que sale del efectivo
            addTransaction('gastos', {
                fecha: nowISO,
                descripcion: `Vale para: ${tercero.nombre} - ${descripcion}`,
                categoria: 'Vales a Personal',
                monto: monto
            });

            showNotification('Éxito', 'Vale registrado y descontado del efectivo.');
            e.target.reset();
            addCurrencyFormatting(e.target);
        }
    });
    
     document.getElementById('form-terceros').addEventListener('submit', (e) => {
        e.preventDefault();
        const nombre = document.getElementById('tercero-nombre').value;
        const tipo = document.getElementById('tercero-tipo').value;
        if (!nombre || !tipo) {
            showNotification('Error', 'Debe completar todos los campos.', 'error');
            return;
        }
        addTransaction('terceros', { nombre, tipo });
        showNotification('Éxito', `Tercero '${nombre}' creado como ${tipo}.`);
        e.target.reset();
    });

    const handleDelete = (type, id, itemMonthKey) => { 
        if (type !== 'terceros' && !validatePeriodAccess(itemMonthKey)) return;
        const item = (allData[type] || []).find(i => i.id === id); 
        if (!item) return; 
        
        const detailsModal = document.getElementById('tercero-details-modal');
        const isDetailsModalVisible = detailsModal.style.display === 'flex';
        
        if (isDetailsModalVisible) {
            detailsModal.style.display = 'none';
        }

        if ((type === 'cuentasPorCobrar' || type === 'vales') && item.abonos && Object.keys(item.abonos).length > 0) { 
            showNotification('Acción no permitida', 'No puede eliminar un registro que ya tiene abonos.', 'error'); 
            if(isDetailsModalVisible) detailsModal.style.display = 'flex'; // Re-show if cancelled
            return; 
        } 
        
        showConfirm('Confirmar Eliminación', '¿Estás seguro? Esta acción no se puede deshacer.', () => { 
            getRefFor(type).child(id).remove().then(() => {
                showNotification('Éxito', 'Registro eliminado.');
                if (isDetailsModalVisible) {
                    detailsModal.style.display = 'none'; // Keep it closed on success
                }
            }).catch((error) => {
                showNotification('Error', 'No se pudo eliminar: ' + error, 'error');
                if(isDetailsModalVisible) detailsModal.style.display = 'flex'; // Re-show on error
            }); 
        }); 
    };

    const handleAbonar = (terceroId, type, legacyName) => {
        const data = allData[type] || [];
        
        const deudasPendientes = data
            .filter(item => {
                const match = terceroId ? item.terceroId === terceroId : (item.cliente || item.acreedor || item.persona) === legacyName;
                if (!match) return false;
                const restante = item.monto - (item.abonos || []).reduce((sum, a) => sum + a.monto, 0);
                return restante > 0;
            })
            .sort((a,b) => a.fecha - b.fecha);
        
        if(deudasPendientes.length === 0){
             showNotification('Información', 'Esta cuenta no tiene saldo pendiente para abonar.', 'info');
             return;
        }

        // Se abonará a la deuda más antigua
        const deudaId = deudasPendientes[0].id; 
        
        // ** FIX: La validación del período de la deuda original se ha eliminado para permitir abonos en cualquier momento. **
        // El abono se registrará como un ingreso en el período ACTIVO actual.
        
        document.getElementById('abono-deuda-id').value = deudaId; 
        document.getElementById('abono-type').value = type; 
        document.getElementById('abono-modal-title').textContent = type === 'vales' ? 'Registrar Abono a Vale' : 'Registrar Abono'; 
        document.getElementById('abono-modal').style.display = 'flex'; 
        addCurrencyFormatting(document.getElementById('abono-modal')); 
    };

    const handleTerceroDetails = (terceroId, type, legacyName) => {
        const tercero = (allData.terceros || []).find(t => t.id === terceroId);
        const displayName = tercero ? tercero.nombre : legacyName;

        if (!displayName) {
            showNotification('Error', 'No se pudo encontrar el tercero.', 'error');
            return;
        }

        const transacciones = (allData[type] || [])
            .filter(item => terceroId ? item.terceroId === terceroId : (item.cliente || item.acreedor || item.persona) === legacyName)
            .sort((a, b) => b.fecha - a.fecha);

        const modal = document.getElementById('tercero-details-modal');
        document.getElementById('tercero-details-title').textContent = `Detalle de Cuenta: ${displayName}`;
        
        const tbody = document.getElementById('tercero-details-body');
        let totalRestante = 0;
        let rowsHTML = '';

        transacciones.forEach(item => {
            const abonos = item.abonos ? Object.values(item.abonos) : [];
            const totalAbonado = abonos.reduce((sum, a) => sum + a.monto, 0);
            const restante = item.monto - totalAbonado;
            totalRestante += restante;
            const isPaid = restante <= 0.01;
            
            rowsHTML += `
                <tr class="bg-white border-b hover:bg-gray-50 font-medium">
                    <td class="px-3 sm:px-4 py-3">${item.fecha.toLocaleDateString('es-CO')}</td>
                    <td class="px-3 sm:px-4 py-3">${item.descripcion}</td>
                    <td class="px-3 sm:px-4 py-3">${formatCurrency(item.monto)}</td>
                    <td class="px-3 sm:px-4 py-3 text-green-600">${formatCurrency(totalAbonado)}</td>
                    <td class="px-3 sm:px-4 py-3 font-bold">${formatCurrency(restante)}</td>
                    <td class="px-3 sm:px-4 py-3">
                         ${!isPaid && abonos.length === 0 ? `<button class="action-button text-red-600 delete-btn" data-type="${type}" data-id="${item.id}" title="Eliminar esta entrada"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `;

            if (abonos.length > 0) {
                 rowsHTML += abonos.sort((a,b) => new Date(b.fecha) - new Date(a.fecha)).map(abono => `
                    <tr class="bg-gray-50 border-b">
                        <td class="px-3 sm:px-4 py-2 text-right" colspan="2">↳ Abono (${abono.metodo})</td>
                        <td class="px-3 sm:px-4 py-2"></td>
                        <td class="px-3 sm:px-4 py-2 text-green-600">-${formatCurrency(abono.monto)}</td>
                        <td class="px-3 sm:px-4 py-2"></td>
                        <td class="px-3 sm:px-4 py-2"></td>
                    </tr>
                `).join('');
            }
        });

        tbody.innerHTML = rowsHTML;
        document.getElementById('tercero-details-total').textContent = formatCurrency(totalRestante);
        modal.style.display = 'flex';
    };
    
    document.getElementById('save-abono-btn').addEventListener('click', async () => { 
        const deudaId = document.getElementById('abono-deuda-id').value; 
        const type = document.getElementById('abono-type').value; 
        const monto = getNumericValue(document.getElementById('abono-monto').value); 
        const metodo = document.getElementById('abono-metodo').value; 
        
        if (!currentPeriod || currentPeriod.isClosed) {
            showNotification('Error', 'No hay un período contable activo y abierto.', 'error');
            return;
        }

        if (!deudaId || !type || monto <= 0) { 
            showNotification('Error', 'Monto inválido o datos incompletos.', 'error'); 
            return; 
        } 
        try { 
            const nowISO = new Date().toISOString();
            const abonoData = { fecha: nowISO, monto, metodo }; 
            await getRefFor(type).child(deudaId).child('abonos').push(abonoData); 

            const deuda = (allData[type] || []).find(d => d.id === deudaId);
            const tercero = (allData.terceros || []).find(t => t.id === deuda.terceroId);
            const persona = tercero ? tercero.nombre : (deuda.cliente || deuda.persona || 'Tercero');
            
            addTransaction('ingresos', {
                fecha: nowISO,
                monthKey: currentPeriod.monthKey,
                monto: monto,
                monto_efectivo: metodo === 'Efectivo' ? monto : 0,
                monto_nequi: metodo === 'Nequi' ? monto : 0,
                monto_tarjeta: metodo === 'Banco' ? monto : 0,
                notas: `Abono de: ${persona}`
            });
            
            showNotification('Éxito', 'Abono registrado correctamente como un ingreso.'); 
            document.getElementById('abono-modal').style.display = 'none'; 
            document.getElementById('form-abono').reset(); 
            document.getElementById('abono-monto').value = ''; 
        } catch (err) { 
            showNotification('Error', 'No se pudo completar la operación.', 'error'); 
            console.error(err); 
        } 
    });

    const handlePagar = (deudaId) => { 
        if (!currentPeriod || currentPeriod.isClosed) {
            showNotification('Error', 'No hay un período contable activo y abierto.', 'error');
            return;
        }

        const deuda = (allData.cuentasPorPagar || []).find(d => d.id === deudaId); 
        if (!deuda) return; 
        showConfirm('Confirmar Pago', `¿Cómo se pagó esta cuenta de ${formatCurrency(deuda.monto)} a ${deuda.acreedor}?`, (metodo) => { 
            if (metodo) { 
                addTransaction('compras', { 
                    fecha: new Date().toISOString(), 
                    proveedor: deuda.acreedor, 
                    descripcion: `Pago Cta. Pendiente: ${deuda.descripcion}`, 
                    monto: deuda.monto, 
                    metodo: metodo 
                }); 
                getRefFor('cuentasPorPagar').child(deudaId).update({ estado: 'Pagada' }); 
                showNotification('Éxito', `Cuenta pagada y registrada como compra.`); 
            } 
        }, true); 
    };

    const showNotification = (title, message, type = 'success') => { const modal = document.getElementById('notification-modal'); document.getElementById('notification-title').textContent = title; document.getElementById('notification-message').textContent = message; document.getElementById('notification-icon').innerHTML = type === 'success' ? `<i class="fas fa-check-circle text-3xl sm:text-4xl text-green-500"></i>` : `<i class="fas fa-times-circle text-3xl sm:text-4xl text-red-500"></i>`; modal.style.display = 'flex'; };
    
    let hiddenContextModalId = null;
    const showConfirm = (title, message, callback, showOptions = false) => {
        const modal = document.getElementById('confirm-modal');
        document.getElementById('confirm-title').textContent = title;
        const msgContainer = document.getElementById('confirm-message-container');
        msgContainer.innerHTML = `<p id="confirm-message" class="text-xs sm:text-sm text-gray-500">${message}</p>`;
        if (showOptions) {
            msgContainer.insertAdjacentHTML('beforeend', `<div class="mt-4"><select id="confirm-options" class="block w-full rounded-md border-gray-300 shadow-sm"><option value="Efectivo">Efectivo</option><option value="Nequi">Nequi</option><option value="Banco">Banco</option></select></div>`);
        }
        modal.classList.remove('z-50');
        modal.classList.add('z-60');
        confirmCallback = () => {
            const optionsEl = document.getElementById('confirm-options');
            callback(showOptions ? optionsEl.value : true);
        };
        modal.style.display = 'flex';
    };

    const cleanupConfirmModal = () => {
        const modal = document.getElementById('confirm-modal');
        const customContent = document.querySelector('#confirm-message-container > div');
        if (customContent) customContent.remove();
        modal.classList.remove('z-60');
        modal.classList.add('z-50');
        modal.style.display = 'none';
        confirmCallback = null;
    };
    
    document.getElementById('notification-close').onclick = () => document.getElementById('notification-modal').style.display = 'none';
    document.getElementById('cancel-confirm-btn').onclick = cleanupConfirmModal;
    document.getElementById('confirm-btn').addEventListener('click', () => { if (confirmCallback) { confirmCallback(); } cleanupConfirmModal(); });
    document.getElementById('cancel-edit-btn').onclick = () => document.getElementById('edit-modal').style.display = 'none';
    document.getElementById('cancel-abono-btn').onclick = () => document.getElementById('abono-modal').style.display = 'none';
    document.getElementById('cancel-historial-btn').onclick = () => document.getElementById('historial-modal').style.display = 'none';
    document.getElementById('logout-btn-main').addEventListener('click', handleLogout);
    document.getElementById('logout-btn-selector').addEventListener('click', handleLogout);
    document.getElementById('switch-business-btn').addEventListener('click', showBusinessSelector);
    document.getElementById('month-filter').addEventListener('change', refreshUI);

    // =========================================================================
    // FUNCIONES DE PDF
    // =========================================================================
    const reportTitles = {
        ingresos: 'Ingresos', compras: 'Compras', gastos: 'Gastos Operacionales', retiros: 'Retiros del Jefe',
        sobrantes: 'Sobrantes del Día', 
        nequi: 'Movimientos de Nequi',
        cuentasPorCobrar: 'Cuentas por Cobrar', cuentasPorPagar: 'Cuentas por Pagar', vales: 'Vales de Personal'
    };
    
    const getPDFStyles = (doc, showFoot) => {
        return {
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
            headStyles: { fillColor: [45, 55, 72], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            footStyles: { fillColor: [237, 242, 247], textColor: [45, 55, 72], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [247, 250, 252] },
            showHead: 'everyPage',
            showFoot: showFoot ? 'lastPage' : 'never',
            didDrawPage: (data) => {
                const pageCount = doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text('Página ' + data.pageNumber + ' de ' + pageCount, data.settings.margin.left, doc.internal.pageSize.height - 10);
            }
        };
    };

    const drawHeader = (doc, title) => {
        const businessName = document.getElementById('app-title').textContent.replace('📊 Gestión: ', '');
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(title, doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(`Negocio: ${businessName}`, 14, 30);
        doc.text(`Generado el: ${new Date().toLocaleString('es-CO')}`, 14, 36);
        return 45;
    };

    const generateHistorialReport = (monthKey) => {
        const period = historialPeriods.find(p => p.monthKey === monthKey);
        if (!period) {
            showNotification('Error', 'No se encontraron datos para el período seleccionado.', 'error');
            return;
        }

        const monthDate = new Date(period.monthKey + '-02T00:00:00');
        const monthName = monthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const title = `Reporte Completo: ${monthName}`;
        const doc = new jsPDF();
        let startY = drawHeader(doc, title);
        
        const periodData = period.data;
        
        const totales = {
            ingresos: (periodData.ingresos || []).reduce((sum, item) => sum + item.monto, 0),
            compras: (periodData.compras || []).reduce((sum, item) => sum + item.monto, 0),
            gastos: (periodData.gastos || []).reduce((sum, item) => sum + item.monto, 0),
            retiros: (periodData.retiros || []).reduce((sum, item) => sum + item.monto, 0)
        };
        const utilidad = totales.ingresos - totales.compras - totales.gastos;

        doc.autoTable({
            startY,
            head: [['Concepto', 'Valor']],
            body: [
                ['Ingresos Totales', formatCurrency(totales.ingresos)],
                ['Compras Totales', formatCurrency(totales.compras)],
                ['Gastos Op. Totales', formatCurrency(totales.gastos)],
                ['Retiros del Jefe', formatCurrency(totales.retiros)],
                ['Utilidad Bruta (Ingresos - Compras - Gastos)', formatCurrency(utilidad)]
            ],
            ...getPDFStyles(doc, false),
            columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } }
        });
        startY = doc.lastAutoTable.finalY + 10;

        const transactionTypeInfo = {
             ingresos: { title: 'Detalle de Ingresos', headers: [['Fecha', 'Notas', 'Efectivo', 'Nequi', 'Banco', 'Total']], body: (d) => [d.fecha.toLocaleDateString('es-CO'), d.notas || '-', formatCurrency(d.monto_efectivo || 0), formatCurrency(d.monto_nequi || 0), formatCurrency(d.monto_tarjeta || 0), formatCurrency(d.monto)], colStyles: { 0:{cellWidth: 20}, 1:{cellWidth: 'auto'}, 2:{cellWidth: 25, halign:'right'}, 3:{cellWidth: 25, halign:'right'}, 4:{cellWidth: 25, halign:'right'}, 5:{cellWidth: 25, halign:'right'} } },
             compras: { title: 'Detalle de Compras', headers: [['Fecha', 'Proveedor', 'Descripción', 'Método', 'Monto']], body: (d) => [d.fecha.toLocaleDateString('es-CO'), d.proveedor, d.descripcion, d.metodo, formatCurrency(d.monto)], colStyles: { 0:{cellWidth: 20}, 1:{cellWidth: 35}, 2:{cellWidth: 'auto'}, 3:{cellWidth: 20}, 4:{cellWidth: 30, halign:'right'} } },
             gastos: { title: 'Detalle de Gastos Op.', headers: [['Fecha', 'Descripción', 'Categoría', 'Monto']], body: (d) => [d.fecha.toLocaleDateString('es-CO'), d.descripcion, d.categoria, formatCurrency(d.monto)], colStyles: { 0:{cellWidth: 20}, 1:{cellWidth: 'auto'}, 2:{cellWidth: 30}, 3:{cellWidth: 30, halign:'right'} } },
             retiros: { title: 'Detalle de Retiros', headers: [['Fecha', 'Descripción', 'Retirado de', 'Monto']], body: (d) => [d.fecha.toLocaleDateString('es-CO'), d.descripcion, d.metodo, formatCurrency(d.monto)], colStyles: { 0:{cellWidth: 20}, 1:{cellWidth: 'auto'}, 2:{cellWidth: 30}, 3:{cellWidth: 30, halign:'right'} } },
        };
        
        for(const type in transactionTypeInfo) {
            const data = (periodData[type] || []).sort((a,b) => a.fecha - b.fecha);
            if (data.length > 0) {
                const info = transactionTypeInfo[type];
                doc.setFontSize(12).setFont('helvetica', 'bold').text(info.title, 14, startY);
                startY += 6;
                const total = data.reduce((sum, item) => sum + item.monto, 0);
                const foot = [[{ content: `Total ${info.title}:`, colSpan: info.headers[0].length - 1, styles: { halign: 'right' } }, { content: formatCurrency(total), styles: { halign: 'right' } }]];
                doc.autoTable({ head: info.headers, body: data.map(info.body), foot: foot, startY, ...getPDFStyles(doc, true), columnStyles: info.colStyles });
                startY = doc.lastAutoTable.finalY + 10;
            }
        }
        
        doc.save(`Reporte_Completo_${monthKey}.pdf`);
        showNotification('Éxito', 'El reporte completo del período se ha generado.');
    };

    const exportToPDF = (type) => {
        const data = (allData[type] || []).filter(d => d.fecha instanceof Date).sort((a, b) => b.fecha - a.fecha);
        const title = `Reporte de ${reportTitles[type]}`;
    
        if (data.length === 0) {
            showNotification('Sin datos', `No hay registros para generar el reporte.`, 'error');
            return;
        }
    
        const doc = new jsPDF();
        let startY = drawHeader(doc, title);
    
        let groupedData;
        let headers, columnStyles;
        let grandTotal = 0;
    
        if (type === 'ingresos') {
            headers = [['Fecha', 'Notas', 'Monto']];
            columnStyles = { 0: { cellWidth: 25 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 40, halign: 'right' } };
            const ingresosPorMetodo = { 'Efectivo': [], 'Nequi': [], 'Banco': [] };
            data.forEach(item => {
                if (item.monto_efectivo > 0) ingresosPorMetodo.Efectivo.push({ ...item, monto_grupo: item.monto_efectivo, notas: item.notas || 'Venta del día' });
                if (item.monto_nequi > 0) ingresosPorMetodo.Nequi.push({ ...item, monto_grupo: item.monto_nequi, notas: `${item.notas || 'Venta'} (Nequi)` });
                if (item.monto_tarjeta > 0) ingresosPorMetodo.Banco.push({ ...item, monto_grupo: item.monto_tarjeta, notas: `${item.notas || 'Venta'} (Banco)` });
            });
            groupedData = ingresosPorMetodo;
        } else {
            const groupingKey = type === 'gastos' ? 'categoria' : 'metodo';
            headers = [['Fecha', 'Descripción', 'Monto']];
            columnStyles = { 0: { cellWidth: 25 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 40, halign: 'right' } };
            groupedData = data.reduce((acc, item) => {
                const key = item[groupingKey];
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
            }, {});
        }
    
        for (const groupName in groupedData) {
            const groupItems = groupedData[groupName];
            if (groupItems.length === 0) continue;
    
            doc.setFontSize(12).setFont('helvetica', 'bold').text(groupName, 14, startY);
            startY += 7;
    
            const body = groupItems.map(item => {
                if (type === 'ingresos') return [item.fecha.toLocaleDateString('es-CO'), item.notas, formatCurrency(item.monto_grupo)];
                return [item.fecha.toLocaleDateString('es-CO'), item.descripcion || item.proveedor, formatCurrency(item.monto)];
            });
    
            const subTotal = groupItems.reduce((sum, item) => sum + (item.monto_grupo !== undefined ? item.monto_grupo : item.monto), 0);
            grandTotal += subTotal;
    
            const foot = [[{ content: `Subtotal ${groupName}:`, colSpan: 2, styles: { halign: 'right' } }, { content: formatCurrency(subTotal), styles: { halign: 'right' } }]];
    
            doc.autoTable({
                head: headers,
                body,
                foot,
                startY,
                ...getPDFStyles(doc, true),
                columnStyles: columnStyles
            });
            startY = doc.lastAutoTable.finalY + 10;
        }
    
        // Grand Total Summary
        doc.setFontSize(14).setFont('helvetica', 'bold').text('Resumen General', 14, startY);
        startY += 8;
        doc.autoTable({
            startY,
            body: [[`Gran Total ${reportTitles[type]}:`, formatCurrency(grandTotal)]],
            ...getPDFStyles(doc, false),
            theme: 'plain',
            bodyStyles: { fontStyle: 'bold', fontSize: 12 },
            columnStyles: { 1: { halign: 'right' } }
        });
    
        doc.save(`Reporte_${reportTitles[type]}.pdf`);
        showNotification('Éxito', 'El reporte profesional se ha generado.');
    };
    
    const exportSobrantesPDF = () => {
        const title = `Reporte de ${reportTitles.sobrantes}`;
        const data = (allData.ingresos || []).filter(d => d.monto_sobrante && d.monto_sobrante > 0 && d.fecha instanceof Date).sort((a, b) => b.fecha - a.fecha);

        if (data.length === 0) {
            showNotification('Sin datos', 'No hay sobrantes para generar el reporte.', 'error');
            return;
        }

        const doc = new jsPDF();
        let startY = drawHeader(doc, title);
        
        const headers = [['Fecha', 'Notas', 'Monto Sobrante']];
        const body = data.map(item => [item.fecha.toLocaleDateString('es-CO'), item.notas || 'Registro de Venta', formatCurrency(item.monto_sobrante)]);
        const total = data.reduce((sum, item) => sum + item.monto_sobrante, 0);
        const foot = [[{ content: 'Total Sobrantes:', colSpan: 2, styles: { halign: 'right' } }, { content: formatCurrency(total), styles: { halign: 'right' } }]];

        doc.autoTable({ 
            head: headers, 
            body, 
            foot, 
            startY, 
            ...getPDFStyles(doc, true),
            columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 40, halign: 'right' } }
        });
        
        doc.save(`Reporte_${reportTitles.sobrantes}.pdf`);
        showNotification('Éxito', 'El reporte de sobrantes se ha generado.');
    };

    const exportNequiPDF = () => {
        const title = `Reporte de ${reportTitles.nequi}`;
        const ingresos = (allData.ingresos || []).filter(i => i.monto_nequi && i.monto_nequi > 0).map(i => ({ fecha: i.fecha, tipo: 'Ingreso', entrada: i.monto_nequi, salida: 0, descripcion: i.notas || 'Venta por Nequi' }));
        const compras = (allData.compras || []).filter(c => c.metodo === 'Nequi').map(c => ({ fecha: c.fecha, tipo: 'Compra', entrada: 0, salida: c.monto, descripcion: `${c.proveedor} - ${c.descripcion}` }));
        const retiros = (allData.retiros || []).filter(r => r.metodo === 'Nequi').map(r => ({ ...r, tipo: 'Retiro', entrada: 0, salida: r.monto }));
        const data = [...ingresos, ...compras, ...retiros].filter(d => d.fecha instanceof Date).sort((a, b) => b.fecha - a.fecha);

        if (data.length === 0) {
            showNotification('Sin datos', 'No hay movimientos de Nequi para el reporte.', 'error');
            return;
        }

        const doc = new jsPDF();
        let startY = drawHeader(doc, title);
        const headers = [['Fecha', 'Tipo', 'Descripción', 'Entrada', 'Salida']];
        const body = data.map(item => [item.fecha.toLocaleDateString('es-CO'), item.tipo, item.descripcion, formatCurrency(item.entrada), formatCurrency(item.salida)]);
        
        const totalEntradas = data.reduce((sum, item) => sum + item.entrada, 0);
        const totalSalidas = data.reduce((sum, item) => sum + item.salida, 0);
        const saldoFinal = totalEntradas - totalSalidas;

        const foot = [
            [{ content: 'Totales:', colSpan: 3, styles: { halign: 'right' } }, { content: formatCurrency(totalEntradas), styles: { halign: 'right' } }, { content: formatCurrency(totalSalidas), styles: { halign: 'right' } }],
            [{ content: 'Saldo Final Nequi:', colSpan: 4, styles: { halign: 'right' } }, { content: formatCurrency(saldoFinal), styles: { halign: 'right' } }]
        ];
        
        doc.autoTable({ 
            head: headers, 
            body, 
            foot,
            startY, 
            ...getPDFStyles(doc, true),
            columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 20 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' } }
        });

        doc.save(`Reporte_${reportTitles.nequi}.pdf`);
        showNotification('Éxito', 'El reporte de Nequi se ha generado.');
    };

    const exportDeudasPDF = (type) => {
        const data = (allData[type] || []).filter(d => d.fecha instanceof Date).sort((a, b) => b.fecha - a.fecha);
        const title = `Reporte de ${reportTitles[type]}`;
        
        if (data.length === 0) {
            showNotification('Sin datos', `No hay registros para generar el reporte.`, 'error');
            return;
        }
        
        const doc = new jsPDF();
        let startY = drawHeader(doc, title);
        
        const personHeader = type === 'vales' ? 'Persona' : (type === 'cuentasPorPagar' ? 'Acreedor' : 'Cliente');
        const headers = [[personHeader, 'Concepto', 'Total Deuda', 'Abonado', 'Saldo']];
        
        const body = data.map(d => {
            const totalAbonado = (d.abonos || []).reduce((sum, a) => sum + a.monto, 0);
            const restante = d.monto - totalAbonado;
            return [d[personHeader.toLowerCase()] || d.cliente || d.persona, d.descripcion, formatCurrency(d.monto), formatCurrency(totalAbonado), formatCurrency(restante)];
        });

        const totalDeuda = data.reduce((sum, item) => sum + item.monto, 0);
        const totalAbonado = data.reduce((sum, item) => sum + (item.abonos || []).reduce((s, a) => s + a.monto, 0), 0);
        const totalRestante = totalDeuda - totalAbonado;
        
        const foot = [[{ content: `Total General:`, colSpan: 2, styles: { halign: 'right' } }, { content: formatCurrency(totalDeuda), styles: { halign: 'right' } }, { content: formatCurrency(totalAbonado), styles: { halign: 'right' } }, { content: formatCurrency(totalRestante), styles: { halign: 'right' } }]];

        doc.autoTable({ 
            head: headers, 
            body, 
            foot,
            startY, 
            ...getPDFStyles(doc, true),
            columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' } }
        });
        
        doc.save(`Reporte_${reportTitles[type]}.pdf`);
        showNotification('Éxito', 'El reporte se ha generado.');
    };
});
