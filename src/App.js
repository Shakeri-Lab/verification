import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import debounce from 'lodash/debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
const DiagnosisGroupingApp = () => {
    const [undoStack, setUndoStack] = useState([]);
    const [newGroupName, setNewGroupName] = useState('');
    const [showAddGroupInput, setShowAddGroupInput] = useState(false);
    const [savedMessage, setSavedMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [groups, setGroups] = useState([]);
    const [computingId, setComputingId] = useState('');
    const [suggestedGroups, setSuggestedGroups] = useState([]);
    const [currentSuggestedIndex, setCurrentSuggestedIndex] = useState(0);
    const [startConfirmed, setStartConfirmed] = useState(false);
    const [draggedDiagnosis, setDraggedDiagnosis] = useState(null);
    const API_BASE_URL = 'https://your-api-url'; // Replace with your actual API URL
    // Function to sort groups alphabetically by name
    const sortGroupsAlphabetically = (arr) => {
        return [...arr].sort((a, b) => a.name.localeCompare(b.name));
    };
    // Function to upload grouped data
    const uploadGroupedData = async (dataToSave) => {
        if (!computingId.trim()) {
            console.warn('Computing ID is empty, skipping S3 upload.');
            return;
        }
        if (!API_BASE_URL.startsWith('https')) {
            console.warn('API_BASE_URL is a placeholder, skipping S3 upload.');
            localStorage.setItem(`${computingId}_grouped_diagnoses_fallback`, JSON.stringify(dataToSave));
            console.log('Data saved to localStorage as fallback.');
            return;
        }
        try {
            const presignedUrlResponse = await fetch(`${API_BASE_URL}/get-presigned-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: `${computingId}_grouped_diagnoses.json` })
            });
            if (!presignedUrlResponse.ok)
                throw new Error(`Failed to get presigned URL: ${presignedUrlResponse.statusText}`);
            const { url: presignedS3Url } = await presignedUrlResponse.json();
            if (!presignedS3Url)
                throw new Error('Presigned URL was not returned from the server.');
            await fetch(presignedS3Url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave),
            });
            console.log('Data successfully auto-saved to S3.');
            localStorage.setItem(`${computingId}_grouped_diagnoses`, JSON.stringify(dataToSave));
        }
        catch (error) {
            console.error('Auto-save to S3 failed:', error);
            localStorage.setItem(`${computingId}_grouped_diagnoses_fallback`, JSON.stringify(dataToSave));
            console.warn('Data saved to localStorage as a fallback due to S3 error.');
        }
    };
    // Debounced upload function
    const debouncedUpload = useRef(debounce((data) => uploadGroupedData(data), 1000)).current;
    // Effect to load initial data
    useEffect(() => {
        const lastId = localStorage.getItem('lastComputingId');
        if (lastId)
            setComputingId(lastId);
        if (!startConfirmed || !computingId.trim())
            return;
        // Function to fetch confirmed groups
        const fetchGroupsFromS3 = async () => {
            setLoading(true);
            let loadedGroups = [];
            if (!API_BASE_URL.startsWith('https')) {
                console.warn('API_BASE_URL is a placeholder. Attempting to load from localStorage only for confirmed groups.');
                const saved = localStorage.getItem(`${computingId}_grouped_diagnoses`) || localStorage.getItem(`${computingId}_grouped_diagnoses_fallback`);
                if (saved) {
                    try {
                        loadedGroups = JSON.parse(saved);
                    }
                    catch (e) {
                        console.error('Failed to parse saved groups from localStorage', e);
                    }
                }
            }
            else {
                try {
                    // Fetching presigned URL for getting the object
                    const presignedUrlResponse = await fetch(`${API_BASE_URL}/get-presigned-url`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: `${computingId}_grouped_diagnoses.json`, action: 'getObject' }) // Assuming backend handles 'action'
                    });
                    if (!presignedUrlResponse.ok)
                        throw new Error(`Presigned URL fetch failed: ${presignedUrlResponse.statusText}`);
                    const { url: presignedS3Url } = await presignedUrlResponse.json();
                    if (!presignedS3Url)
                        throw new Error('Presigned URL not returned.');
                    const s3DataResponse = await fetch(presignedS3Url);
                    if (!s3DataResponse.ok)
                        throw new Error(`S3 data fetch failed: ${s3DataResponse.statusText}`);
                    loadedGroups = await s3DataResponse.json();
                    localStorage.setItem(`${computingId}_grouped_diagnoses`, JSON.stringify(loadedGroups));
                }
                catch (s3Error) {
                    console.warn('S3 fetch for confirmed groups failed, trying localStorage:', s3Error);
                    const saved = localStorage.getItem(`${computingId}_grouped_diagnoses`) || localStorage.getItem(`${computingId}_grouped_diagnoses_fallback`);
                    if (saved)
                        try {
                            loadedGroups = JSON.parse(saved);
                        }
                        catch (e) { /* ignore parse error on fallback */ }
                }
            }
            setGroups(sortGroupsAlphabetically(loadedGroups)); // Sort loaded groups
            setLoading(false);
        };
        // Function to fetch suggested groups
        const fetchSuggestedGroups = async () => {
            setLoading(true);
            try {
                const res = await fetch('/verification/diagnoses.json'); // Path to your diagnoses data
                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`HTTP error! status: ${res.status}, message: ${errorText}, path: /verification/diagnoses.json`);
                }
                const data = await res.json();
                const allGroups = Object.entries(data).map(([groupId, value], index) => {
                    const [codes, names] = value;
                    const diagnoses = names.map((name, i) => ({
                        id: codes[i] ? codes[i].toString() : `unknown-id-${groupId}-${i}-${Date.now()}`,
                        name, description: ''
                    }));
                    return {
                        id: `suggested-${groupId}-${Date.now()}`, name: `Suggested Group ${index + 1}`,
                        diagnoses, subgroups: [], collapsed: false
                    };
                });
                setSuggestedGroups(allGroups);
            }
            catch (error) {
                console.error('Failed to load or parse diagnoses.json:', error);
                setSuggestedGroups([]);
            }
            finally {
                setLoading(false);
            }
        };
        fetchGroupsFromS3();
        fetchSuggestedGroups();
    }, [startConfirmed, computingId]);
    // Effect to update the current suggested group index
    useEffect(() => {
        if (!startConfirmed)
            return;
        if (suggestedGroups.length === 0) {
            setCurrentSuggestedIndex(0);
            return;
        }
        const nextIncompleteIndex = suggestedGroups.findIndex(sg => sg.diagnoses.length > 0);
        setCurrentSuggestedIndex(nextIncompleteIndex !== -1 ? nextIncompleteIndex : suggestedGroups.length);
    }, [suggestedGroups, startConfirmed]);
    // Handler for starting drag operation
    const handleDragStart = (diagnosis) => setDraggedDiagnosis(diagnosis);
    // Recursive function to process dropping a diagnosis into groups/subgroups
    const processDropInGroups = (currentGroups, targetGroupId, diagnosisToDrop) => {
        return currentGroups.map(group => {
            let diagnosesInGroup = group.diagnoses.filter(d => d.id !== diagnosisToDrop.id);
            let subgroupsInGroup = group.subgroups ? processDropInGroups(group.subgroups, targetGroupId, diagnosisToDrop) : [];
            if (group.id === targetGroupId && !diagnosesInGroup.find(d => d.id === diagnosisToDrop.id)) {
                diagnosesInGroup = [...diagnosesInGroup, diagnosisToDrop];
            }
            return { ...group, diagnoses: diagnosesInGroup, subgroups: subgroupsInGroup };
        });
    };
    // Handler for dropping a diagnosis
    const handleDrop = (targetGroupId) => {
        if (!draggedDiagnosis)
            return;
        setUndoStack(prev => [...prev.slice(-9), groups]);
        const updatedConfirmedGroups = processDropInGroups(groups, targetGroupId, draggedDiagnosis);
        const updatedSuggestedGroups = suggestedGroups.map(sg => ({
            ...sg, diagnoses: sg.diagnoses.filter(d => d.id !== draggedDiagnosis.id)
        }));
        // The order of confirmed groups is maintained by sortGroupsAlphabetically on add/load,
        // processDropInGroups only modifies content, not the order of top-level groups.
        setGroups(updatedConfirmedGroups);
        setSuggestedGroups(updatedSuggestedGroups);
        debouncedUpload(updatedConfirmedGroups);
        setDraggedDiagnosis(null);
    };
    // Function to add a new subgroup
    const addSubgroup = (parentGroupId) => {
        const name = prompt('Enter subgroup name:');
        if (!name || !name.trim())
            return;
        const newSubgroup = {
            id: crypto.randomUUID(), name: name.trim(), diagnoses: [], subgroups: [], collapsed: false,
        };
        const addSubgroupRecursive = (currentGroups) => {
            return currentGroups.map(g => {
                if (g.id === parentGroupId)
                    return { ...g, subgroups: [...(g.subgroups || []), newSubgroup] };
                if (g.subgroups)
                    return { ...g, subgroups: addSubgroupRecursive(g.subgroups) };
                return g;
            });
        };
        const updatedGroups = addSubgroupRecursive(groups);
        setGroups(updatedGroups); // Order of top-level groups is not affected here.
        debouncedUpload(updatedGroups);
    };
    // Function to toggle group collapse state
    const toggleGroupCollapse = (groupId) => {
        const toggleRecursive = (currentGroups) => currentGroups.map(g => {
            if (g.id === groupId)
                return { ...g, collapsed: !g.collapsed };
            if (g.subgroups)
                return { ...g, subgroups: toggleRecursive(g.subgroups) };
            return g;
        });
        setGroups(toggleRecursive(groups));
    };
    // Handler for reordering subgroups
    const handleReorderSubgroups = (parentGroupId, reorderedSubgroups) => {
        setUndoStack(prev => [...prev.slice(-9), groups]);
        const updateSubgroupsOrderRecursive = (currentGroups, targetParentId, newOrder) => {
            return currentGroups.map(g => {
                if (g.id === targetParentId)
                    return { ...g, subgroups: newOrder };
                if (g.subgroups && g.subgroups.length > 0) {
                    return { ...g, subgroups: updateSubgroupsOrderRecursive(g.subgroups, targetParentId, newOrder) };
                }
                return g;
            });
        };
        const updatedGroups = updateSubgroupsOrderRecursive(groups, parentGroupId, reorderedSubgroups);
        setGroups(updatedGroups); // Order of top-level groups is not affected here.
        debouncedUpload(updatedGroups);
    };
    // Recursive function to render a group and its subgroups
    const renderGroup = (group, indentLevel = 0) => (_jsxs(motion.div, { layout: true, initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, onDrop: (e) => { e.preventDefault(); e.stopPropagation(); handleDrop(group.id); }, className: cn("p-3 md:p-4 rounded-md space-y-2 shadow-md mb-3 bg-gray-800", indentLevel > 0 && "border border-gray-600" // Border only for subgroups
        ), style: { marginLeft: `${indentLevel * 20}px` }, children: [_jsx("div", { className: "flex items-center justify-between", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); toggleGroupCollapse(group.id); }, className: "p-1 hover:bg-gray-700 rounded text-gray-400", "aria-label": group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`, children: group.collapsed ? _jsx(ChevronRight, { size: 18 }) : _jsx(ChevronDown, { size: 18 }) }), _jsx("h3", { className: "font-semibold text-lg text-white", children: group.name })] }) }), !group.collapsed && (_jsxs("div", { className: "pl-2 md:pl-4 pt-2 space-y-2", children: [group.diagnoses.map(d => (_jsx(motion.div, { draggable: true, onDragStart: () => handleDragStart(d), className: "bg-gray-700 p-2 rounded-md cursor-grab hover:bg-gray-600 transition-colors", layoutId: `diagnosis-${d.id}`, children: _jsx("p", { className: "text-sm text-gray-200", children: d.name }) }, d.id))), (group.subgroups && group.subgroups.length > 0) && (_jsx(Reorder.Group, { axis: "y", values: group.subgroups, onReorder: (newOrder) => handleReorderSubgroups(group.id, newOrder), className: "space-y-2 pt-2", children: group.subgroups.map(sub => (_jsx(Reorder.Item, { value: sub, className: "cursor-grab rounded-md", children: renderGroup(sub, indentLevel + 1) }, sub.id))) })), _jsxs(Button, { size: "sm", variant: "ghost", onClick: (e) => { e.stopPropagation(); addSubgroup(group.id); }, className: cn("mt-2 text-blue-400 hover:text-blue-300 text-xs"), children: [_jsx(Plus, { size: 14, className: "mr-1" }), " Add Subgroup"] })] }))] }, group.id));
    // Initial screen for computing ID
    if (!startConfirmed) {
        return (_jsx("div", { className: "min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 space-y-6", children: _jsxs("div", { className: "bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md", children: [_jsx("h1", { className: "text-2xl sm:text-3xl font-bold text-center text-white mb-6", children: "Diagnosis Grouping Tool" }), _jsx("p", { className: "text-center text-gray-400 mb-2", children: "Enter your Computing ID to load your saved progress or start a new session." }), _jsx(Input, { type: "text", placeholder: "Computing ID (e.g., ast1x)", value: computingId, onChange: (e) => { const value = e.target.value.trim(); setComputingId(value); }, className: cn("w-full mb-4 bg-gray-700 border-gray-600 placeholder-gray-500") }), _jsx(Button, { onClick: () => {
                            if (computingId.trim()) {
                                localStorage.setItem('lastComputingId', computingId.trim());
                                setStartConfirmed(true);
                            }
                            else {
                                alert("Please enter a Computing ID.");
                            }
                        }, disabled: !computingId.trim(), className: cn("w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-500"), children: " Start / Load Session " })] }) }));
    }
    // Main application UI
    return (_jsxs("div", { className: "min-h-screen bg-gray-900 text-gray-100 p-4 md:p-6 flex flex-col", children: [_jsxs("header", { className: "mb-6 flex flex-wrap justify-between items-center gap-4", children: [_jsxs("h1", { className: "text-2xl md:text-3xl font-bold text-white", children: ["Diagnosis Grouping: ", _jsx("span", { className: "text-blue-400", children: computingId })] }), _jsxs("div", { className: "flex gap-2 sm:gap-4 items-center", children: [_jsx(Button, { onClick: () => { setUndoStack(prev => [...prev.slice(-9), groups]); uploadGroupedData(groups); setSavedMessage('Progress saved!'); setTimeout(() => setSavedMessage(''), 3000); }, className: cn("bg-green-600 hover:bg-green-700 text-sm sm:text-base"), children: " Save Progress " }), _jsxs(Button, { onClick: () => { const previousState = undoStack.pop(); if (previousState) {
                                    setGroups(previousState);
                                    setUndoStack([...undoStack]);
                                    debouncedUpload(previousState);
                                    setSavedMessage('Undo successful.');
                                    setTimeout(() => setSavedMessage(''), 2000);
                                }
                                else {
                                    setSavedMessage('No more actions to undo.');
                                    setTimeout(() => setSavedMessage(''), 2000);
                                } }, disabled: undoStack.length === 0, className: cn("bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-500 text-sm sm:text-base"), children: [" Undo (", undoStack.length, ") "] }), savedMessage && _jsx("span", { className: "text-sm text-green-400", children: savedMessage })] })] }), loading && (_jsxs("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500" }), _jsx("span", { className: "ml-4 text-xl text-white", children: "Loading Data..." })] })), _jsxs("main", { className: "flex flex-row gap-4 md:gap-6 flex-grow", style: { height: 'calc(100vh - 150px)' }, children: [_jsxs("section", { className: "w-1/3 lg:w-1/4 bg-gray-800 p-4 rounded-lg shadow-lg overflow-y-auto", children: [_jsx("h2", { className: "text-xl font-semibold text-white mb-3 sticky top-0 bg-gray-800 py-2 z-10", children: "Suggested Diagnoses" }), suggestedGroups.length > 0 && currentSuggestedIndex < suggestedGroups.length && suggestedGroups[currentSuggestedIndex] ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mb-4 p-3 bg-gray-700 rounded-md text-white", children: [_jsxs("p", { className: "text-md font-medium mb-2", children: [suggestedGroups[currentSuggestedIndex].name, ": How would you like to group these?"] }), _jsx("div", { className: "flex gap-2 sm:gap-4", children: _jsx(Button, { onClick: () => {
                                                        const currentSuggestion = suggestedGroups[currentSuggestedIndex];
                                                        if (!currentSuggestion || currentSuggestion.diagnoses.length === 0)
                                                            return;
                                                        const inputName = prompt('Enter a name for this new group:', currentSuggestion.name);
                                                        if (!inputName || !inputName.trim())
                                                            return;
                                                        const trimmedName = inputName.trim();
                                                        setUndoStack(prev => [...prev.slice(-9), groups]);
                                                        const existingGroup = groups.find(g => g.name.toLowerCase() === trimmedName.toLowerCase());
                                                        if (existingGroup) {
                                                            // Merge with existing group
                                                            const updatedGroups = groups.map(g => {
                                                                if (g.id === existingGroup.id) {
                                                                    const diagnosesToAdd = currentSuggestion.diagnoses.filter(sd => !g.diagnoses.some(d => d.id === sd.id) // Avoid duplicates
                                                                    );
                                                                    return { ...g, diagnoses: [...g.diagnoses, ...diagnosesToAdd] };
                                                                }
                                                                return g;
                                                            });
                                                            setGroups(updatedGroups); // Group order doesn't change, no need to re-sort
                                                            debouncedUpload(updatedGroups);
                                                        }
                                                        else {
                                                            // Create new group
                                                            const newGroup = {
                                                                id: crypto.randomUUID(), name: trimmedName,
                                                                diagnoses: [...currentSuggestion.diagnoses],
                                                                subgroups: [], collapsed: false,
                                                            };
                                                            const updatedGroups = sortGroupsAlphabetically([...groups, newGroup]);
                                                            setGroups(updatedGroups);
                                                            debouncedUpload(updatedGroups);
                                                        }
                                                        // Mark current suggestion's diagnoses as moved
                                                        const updatedSuggested = suggestedGroups.map((sg, idx) => idx === currentSuggestedIndex ? { ...sg, diagnoses: [] } : sg);
                                                        setSuggestedGroups(updatedSuggested);
                                                    }, className: cn("bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm flex-1"), disabled: !suggestedGroups[currentSuggestedIndex]?.diagnoses || suggestedGroups[currentSuggestedIndex].diagnoses.length === 0, children: " Create / Merge Group " }) }), _jsx("p", { className: "text-xs text-gray-400 mt-2", children: " Or, drag them individually to your groups on the right. " })] }), _jsx("div", { className: "space-y-2", children: (suggestedGroups[currentSuggestedIndex]?.diagnoses || []).map((d) => (_jsx(motion.div, { draggable: true, onDragStart: () => handleDragStart(d), className: "bg-gray-700 rounded-md p-3 cursor-grab hover:bg-gray-600 transition-colors", layoutId: `diagnosis-${d.id}-suggested`, children: _jsx("h3", { className: "text-sm font-medium text-gray-200", children: d.name }) }, d.id))) }), suggestedGroups[currentSuggestedIndex]?.diagnoses.length > 0 &&
                                        _jsx("p", { className: "text-xs text-gray-400 mt-3", children: "These items must be grouped before proceeding." })] })) : (
                            // No suggestions message - Restored
                            _jsxs("p", { className: "text-gray-400 p-3", children: [loading && "Loading suggestions...", !loading && suggestedGroups.length === 0 && "No suggestions loaded or an error occurred.", !loading && suggestedGroups.length > 0 && currentSuggestedIndex >= suggestedGroups.length && "All suggestions have been processed. You can continue to create groups manually."] }))] }), _jsxs("section", { className: "w-2/3 lg:w-3/4 bg-gray-850 p-4 rounded-lg shadow-lg overflow-y-auto relative", children: [_jsx("h2", { className: "text-xl font-semibold text-white mb-3 sticky top-0 bg-gray-850 py-2 z-10", children: "Your Confirmed Groups" }), _jsx(AnimatePresence, { children: groups.map(group => renderGroup(group, 0)) }), _jsx("div", { className: "mt-6 sticky bottom-0 bg-gray-850 py-3", children: showAddGroupInput ? (_jsxs("div", { className: "flex flex-col sm:flex-row items-center gap-2 p-3 bg-gray-700 rounded-md", children: [_jsx(Input, { type: "text", placeholder: "New Group Name", value: newGroupName, onChange: e => setNewGroupName(e.target.value), className: cn("flex-grow bg-gray-600 border-gray-500 placeholder-gray-400") }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { onClick: () => {
                                                        const trimmedNewGroupName = newGroupName.trim();
                                                        if (!trimmedNewGroupName)
                                                            return;
                                                        const groupNameExists = groups.some(g => g.name.toLowerCase() === trimmedNewGroupName.toLowerCase());
                                                        if (groupNameExists) {
                                                            alert("A group with this name already exists. Please choose a different name.");
                                                            return;
                                                        }
                                                        setUndoStack(prev => [...prev.slice(-9), groups]);
                                                        const newGroupToAdd = { id: crypto.randomUUID(), name: trimmedNewGroupName, diagnoses: [], subgroups: [], collapsed: false };
                                                        const updatedGroups = sortGroupsAlphabetically([...groups, newGroupToAdd]);
                                                        setGroups(updatedGroups);
                                                        debouncedUpload(updatedGroups);
                                                        setNewGroupName('');
                                                        setShowAddGroupInput(false);
                                                    }, className: cn("bg-blue-600 hover:bg-blue-700"), children: " Add Group " }), _jsx(Button, { variant: "ghost", onClick: () => { setShowAddGroupInput(false); setNewGroupName(''); }, className: cn("hover:bg-gray-600"), children: " Cancel " })] })] })) : (
                                // Create New Group button - Restored
                                _jsxs(Button, { onClick: () => setShowAddGroupInput(true), className: cn("w-full sm:w-auto bg-green-600 hover:bg-green-700"), children: [_jsx(Plus, { className: "w-4 h-4 mr-2" }), " Create New Group"] })) })] })] })] }));
};
export default DiagnosisGroupingApp;
