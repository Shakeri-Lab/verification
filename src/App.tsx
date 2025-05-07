import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import debounce from 'lodash/debounce';

// Assuming these paths are correct for your project structure
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Diagnosis {
  id: string;
  name: string;
  description: string;
}

interface Group {
  id: string;
  name: string;
  diagnoses: Diagnosis[];
  subgroups?: Group[];
  collapsed?: boolean;
}

// Type for the data structure expected from diagnoses.json
interface DiagnosesData {
  [groupId: string]: [string[], string[]]; // [codes, names]
}

const DiagnosisGroupingApp = (): React.JSX.Element => {
  const [undoStack, setUndoStack] = useState<Group[][]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [showAddGroupInput, setShowAddGroupInput] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]); // User's confirmed groups
  const [computingId, setComputingId] = useState('');
  const [suggestedGroups, setSuggestedGroups] = useState<Group[]>([]); // Filtered suggested groups
  const [currentSuggestedIndex, setCurrentSuggestedIndex] = useState(0);
  const [startConfirmed, setStartConfirmed] = useState(false);
  const [draggedDiagnosis, setDraggedDiagnosis] = useState<Diagnosis | null>(null);

  const API_BASE_URL = 'https://your-api-url'; // Replace with your actual API URL

  const sortGroupsAlphabetically = (arr: Group[]): Group[] => {
    return [...arr].sort((a, b) => a.name.localeCompare(b.name));
  };

  const uploadGroupedData = async (dataToSave: Group[]) => {
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
        body: JSON.stringify({ filename: `${computingId}_grouped_diagnoses.json`, action: 'putObject' })
      });
      if (!presignedUrlResponse.ok) throw new Error(`Failed to get presigned URL for upload: ${presignedUrlResponse.statusText}`);
      const { url: presignedS3Url } = await presignedUrlResponse.json();
      if (!presignedS3Url) throw new Error('Presigned URL for upload was not returned.');
      await fetch(presignedS3Url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave),
      });
      console.log('Data successfully auto-saved to S3.');
      localStorage.setItem(`${computingId}_grouped_diagnoses`, JSON.stringify(dataToSave));
    } catch (error) {
      console.error('Auto-save to S3 failed:', error);
      localStorage.setItem(`${computingId}_grouped_diagnoses_fallback`, JSON.stringify(dataToSave));
      console.warn('Data saved to localStorage as a fallback due to S3 error.');
    }
  };

  const debouncedUpload = useRef(debounce((data: Group[]) => uploadGroupedData(data), 1000)).current;

  useEffect(() => {
    const lastId = localStorage.getItem('lastComputingId');
    if (lastId) setComputingId(lastId);

    const loadAllData = async () => {
      if (!startConfirmed || !computingId.trim()) return;
      setLoading(true);

      let loadedConfirmedGroups: Group[] = [];
      if (API_BASE_URL === 'https://your-api-url' || !API_BASE_URL.startsWith('https')) {
        console.warn('API_BASE_URL is a placeholder or invalid. Attempting to load from localStorage only for confirmed groups.');
        const saved = localStorage.getItem(`${computingId}_grouped_diagnoses`) || localStorage.getItem(`${computingId}_grouped_diagnoses_fallback`);
        if (saved) {
          try { loadedConfirmedGroups = JSON.parse(saved); } catch (e) { console.error('Failed to parse saved groups from localStorage', e); loadedConfirmedGroups = []; }
        }
      } else {
        try {
          const presignedUrlResponse = await fetch(`${API_BASE_URL}/get-presigned-url`, {
             method: 'POST', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ filename: `${computingId}_grouped_diagnoses.json`, action: 'getObject' })
          });
          if (!presignedUrlResponse.ok) throw new Error(`Presigned URL fetch for confirmed groups failed: ${presignedUrlResponse.statusText}`);
          const { url: presignedS3Url } = await presignedUrlResponse.json();
          if (!presignedS3Url) throw new Error('Presigned URL for confirmed groups not returned.');
          const s3DataResponse = await fetch(presignedS3Url);
          if (!s3DataResponse.ok) throw new Error(`S3 data fetch for confirmed groups failed: ${s3DataResponse.statusText}`);
          loadedConfirmedGroups = await s3DataResponse.json();
          localStorage.setItem(`${computingId}_grouped_diagnoses`, JSON.stringify(loadedConfirmedGroups));
        } catch (s3Error) {
          console.warn('S3 fetch for confirmed groups failed, trying localStorage:', s3Error);
          const saved = localStorage.getItem(`${computingId}_grouped_diagnoses`) || localStorage.getItem(`${computingId}_grouped_diagnoses_fallback`);
          if (saved) try { loadedConfirmedGroups = JSON.parse(saved); } catch (e) { loadedConfirmedGroups = []; }
        }
      }

      let rawSuggestedGroupsList: Group[] = [];
      try {
        const res = await fetch('/verification/diagnoses.json');
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP error fetching suggestions! status: ${res.status}, message: ${errorText}, path: /verification/diagnoses.json`);
        }
        const data: DiagnosesData = await res.json();
        rawSuggestedGroupsList = Object.entries(data).map(([groupId, value]: [string, [string[], string[]]], index: number) => {
          const [codes, names] = value;
          const diagnoses: Diagnosis[] = names.map((name: string, i: number) => {
            const stableFallbackId = `generated-${groupId}-${name.toLowerCase().replace(/[^a-z0-9]/gi, '')}-${i}`;
            return {
              id: codes[i] ? codes[i].toString() : stableFallbackId,
              name, description: ''
            };
          });
          return {
            id: `suggested-group-${groupId}-${Date.now()}`, 
            name: `Suggested Group ${index + 1}`,
            diagnoses, subgroups: [], collapsed: false
          };
        });
      } catch (error) {
        console.error('Failed to load or parse diagnoses.json:', error);
      }

      const diagnosisIdsInConfirmedGroups = new Set<string>();
      function collectDiagnosisIds(groupList: Group[]) {
        for (const group of groupList) {
          group.diagnoses.forEach(d => diagnosisIdsInConfirmedGroups.add(d.id));
          if (group.subgroups) {
            collectDiagnosisIds(group.subgroups);
          }
        }
      }
      collectDiagnosisIds(loadedConfirmedGroups);

      const filteredSuggestedGroups = rawSuggestedGroupsList.map(sg => ({
        ...sg,
        diagnoses: sg.diagnoses.filter(d => !diagnosisIdsInConfirmedGroups.has(d.id))
      }));

      setGroups(sortGroupsAlphabetically(loadedConfirmedGroups));
      setSuggestedGroups(filteredSuggestedGroups);
      setLoading(false); // Loading is set to false AFTER all processing and state updates
    };

    if (startConfirmed && computingId.trim()) {
        loadAllData();
    } else {
        setGroups([]);
        setSuggestedGroups([]);
        setLoading(false);
    }

  }, [startConfirmed, computingId]);

  useEffect(() => {
    if (!startConfirmed) {
        setCurrentSuggestedIndex(0);
        return;
    }
    if (suggestedGroups.length === 0) {
      setCurrentSuggestedIndex(0);
      return;
    }
    const nextIncompleteIndex = suggestedGroups.findIndex((sg: Group) => sg.diagnoses.length > 0);
    if (nextIncompleteIndex !== -1) {
      setCurrentSuggestedIndex(nextIncompleteIndex);
    } else {
      setCurrentSuggestedIndex(suggestedGroups.length);
    }
  }, [suggestedGroups, startConfirmed]);

  const handleDragStart = (diagnosis: Diagnosis) => setDraggedDiagnosis(diagnosis);

  const processDropInGroups = (currentGroups: Group[], targetGroupId: string, diagnosisToDrop: Diagnosis): Group[] => {
    return currentGroups.map((group: Group) => {
      let diagnosesInGroup = group.diagnoses.filter((d: Diagnosis) => d.id !== diagnosisToDrop.id);
      let subgroupsInGroup = group.subgroups ? processDropInGroups(group.subgroups, targetGroupId, diagnosisToDrop) : [];
      if (group.id === targetGroupId && !diagnosesInGroup.find((d: Diagnosis) => d.id === diagnosisToDrop.id)) {
        diagnosesInGroup = [...diagnosesInGroup, diagnosisToDrop];
      }
      return { ...group, diagnoses: diagnosesInGroup, subgroups: subgroupsInGroup };
    });
  };

  const handleDrop = (targetGroupId: string) => {
    if (!draggedDiagnosis) return;
    setUndoStack(prev => [...prev.slice(-9), groups]);
    const updatedConfirmedGroups = processDropInGroups(groups, targetGroupId, draggedDiagnosis);
    const updatedSuggestedGroups = suggestedGroups.map((sg: Group) => ({
      ...sg, diagnoses: sg.diagnoses.filter((d: Diagnosis) => d.id !== draggedDiagnosis.id)
    }));
    setGroups(updatedConfirmedGroups);
    setSuggestedGroups(updatedSuggestedGroups);
    debouncedUpload(updatedConfirmedGroups);
    setDraggedDiagnosis(null);
  };

  const addSubgroup = (parentGroupId: string) => {
    const name = prompt('Enter subgroup name:');
    if (!name || !name.trim()) return;
    const newSubgroup: Group = {
      id: crypto.randomUUID(), name: name.trim(), diagnoses: [], subgroups: [], collapsed: false,
    };
    const addSubgroupRecursive = (currentGroups: Group[]): Group[] => {
      return currentGroups.map((g: Group) => {
        if (g.id === parentGroupId) return { ...g, subgroups: [...(g.subgroups || []), newSubgroup] };
        if (g.subgroups) return { ...g, subgroups: addSubgroupRecursive(g.subgroups) };
        return g;
      });
    };
    const updatedGroups = addSubgroupRecursive(groups);
    setGroups(updatedGroups);
    debouncedUpload(updatedGroups);
  };

  const toggleGroupCollapse = (groupId: string) => {
    const toggleRecursive = (currentGroups: Group[]): Group[] => currentGroups.map((g: Group) => {
      if (g.id === groupId) return { ...g, collapsed: !g.collapsed };
      if (g.subgroups) return { ...g, subgroups: toggleRecursive(g.subgroups) };
      return g;
    });
    setGroups(toggleRecursive(groups));
  };

  const handleReorderSubgroups = (parentGroupId: string, reorderedSubgroups: Group[]) => {
    setUndoStack(prev => [...prev.slice(-9), groups]);
    const updateSubgroupsOrderRecursive = (currentGroups: Group[], targetParentId: string, newOrder: Group[]): Group[] => {
      return currentGroups.map((g: Group) => {
        if (g.id === targetParentId) return { ...g, subgroups: newOrder as Group[] };
        if (g.subgroups && g.subgroups.length > 0) {
          return { ...g, subgroups: updateSubgroupsOrderRecursive(g.subgroups, targetParentId, newOrder) };
        }
        return g;
      });
    };
    const updatedGroups = updateSubgroupsOrderRecursive(groups, parentGroupId, reorderedSubgroups);
    setGroups(updatedGroups);
    debouncedUpload(updatedGroups);
  };

  const renderGroup = (group: Group, indentLevel = 0): React.JSX.Element => (
    <motion.div
      key={group.id}
      layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(group.id); }}
      className={cn(
        'p-3 md:p-4 rounded-md space-y-2 shadow-md mb-3 bg-gray-800',
        indentLevel > 0 && 'border border-gray-600'
      )}
      style={{ marginLeft: `${indentLevel * 20}px` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="p-1 hover:bg-gray-700 rounded text-gray-400"
            onClick={e => { e.stopPropagation(); toggleGroupCollapse(group.id); }}
            aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
          >
            {group.collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          </button>
          <h3 className="font-semibold text-lg text-white">{group.name}</h3>
        </div>
      </div>
      {!group.collapsed && (
        <div className="pl-2 md:pl-4 pt-2 space-y-2">
          {group.diagnoses.map((d: Diagnosis) => (
            <motion.div key={d.id} draggable onDragStart={() => handleDragStart(d)}
              className="bg-gray-700 p-2 rounded-md cursor-grab hover:bg-gray-600 transition-colors"
              layoutId={`diagnosis-${d.id}`}
            >
              <p className="text-sm text-gray-200">{d.name}</p>
            </motion.div>
          ))}
          {(group.subgroups && group.subgroups.length > 0) && (
            <Reorder.Group axis="y" values={group.subgroups}
              onReorder={(newOrder) => handleReorderSubgroups(group.id, newOrder as Group[])}
              className="space-y-2 pt-2"
            >
              {group.subgroups.map((sub: Group) => (
                <Reorder.Item key={sub.id} value={sub} className="cursor-grab rounded-md">
                  {renderGroup(sub, indentLevel + 1)}
                </Reorder.Item>
              ))}
            </Reorder.Group>
          )}
          <Button size="sm" variant="ghost"
            onClick={(e) => { e.stopPropagation(); addSubgroup(group.id); }}
            className={cn("mt-2 text-blue-400 hover:text-blue-300 text-xs")}
          >
            <Plus size={14} className="mr-1" /> Add Subgroup
          </Button>
        </div>
      )}
    </motion.div>
  );

  if (!startConfirmed) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 space-y-6">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md">
          <h1 className="text-2xl sm:text-3xl font-bold text-center text-white mb-6">Diagnosis Grouping Tool</h1>
          <p className="text-center text-gray-400 mb-2">Enter your Computing ID to load your saved progress or start a new session.</p>
          <Input type="text" placeholder="Computing ID (e.g., ast1x)" value={computingId}
            onChange={(e) => { const value = e.target.value.trim(); setComputingId(value); }}
            className={cn("w-full mb-4 bg-gray-700 border-gray-600 placeholder-gray-500")}
          />
          <Button
            onClick={() => {
              if (computingId.trim()) { localStorage.setItem('lastComputingId', computingId.trim()); setStartConfirmed(true); }
              else { alert("Please enter a Computing ID."); }
            }}
            disabled={!computingId.trim()}
            className={cn("w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-500")}
          > Start / Load Session </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-6 flex flex-col">
      <header className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-white">Diagnosis Grouping: <span className="text-blue-400">{computingId}</span></h1>
        <div className="flex gap-2 sm:gap-4 items-center">
            <Button onClick={() => { setUndoStack(prev => [...prev.slice(-9), groups]); uploadGroupedData(groups); setSavedMessage('Progress saved!'); setTimeout(() => setSavedMessage(''), 3000); }}
                className={cn("bg-green-600 hover:bg-green-700 text-sm sm:text-base")}
            > Save Progress </Button>
            <Button onClick={() => { const previousState = undoStack.pop(); if (previousState) { setGroups(previousState); setUndoStack([...undoStack]); debouncedUpload(previousState); setSavedMessage('Undo successful.'); setTimeout(() => setSavedMessage(''), 2000); } else { setSavedMessage('No more actions to undo.'); setTimeout(() => setSavedMessage(''), 2000); } }}
                disabled={undoStack.length === 0} className={cn("bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-500 text-sm sm:text-base")}
            > Undo ({undoStack.length}) </Button>
            {savedMessage && <span className="text-sm text-green-400">{savedMessage}</span>}
        </div>
      </header>

      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500"></div>
          <span className="ml-4 text-xl text-white">Loading Data...</span>
        </div>
      )}

      <main className="flex flex-row gap-4 md:gap-6 flex-grow" style={{ height: 'calc(100vh - 150px)' }}>
        <section className="w-1/2 bg-gray-800 p-4 rounded-lg shadow-lg overflow-y-auto">
          <h2 className="text-xl font-semibold text-white mb-3 sticky top-0 bg-gray-800 py-2 z-10">Suggested Diagnoses</h2>
          {/* MODIFIED: Added '!loading' to the condition to prevent rendering suggestions while loading */}
          {suggestedGroups.length > 0 && currentSuggestedIndex < suggestedGroups.length && suggestedGroups[currentSuggestedIndex] && !loading ? (
            <>
              <div className="mb-4 p-3 bg-gray-700 rounded-md text-white">
                <p className="text-md font-medium mb-2">
                  {suggestedGroups[currentSuggestedIndex].name}: How would you like to group these?
                </p>
                <div className="flex gap-2 sm:gap-4">
                  <Button
                    onClick={() => {
                      const currentSuggestion = suggestedGroups[currentSuggestedIndex];
                      if (!currentSuggestion || currentSuggestion.diagnoses.length === 0) return;
                      const inputName = prompt('Enter a name for this new group:', currentSuggestion.name);
                      if (!inputName || !inputName.trim()) return;

                      const trimmedName = inputName.trim();
                      setUndoStack(prev => [...prev.slice(-9), groups]);

                      const existingGroup = groups.find((g: Group) => g.name.toLowerCase() === trimmedName.toLowerCase());

                      if (existingGroup) {
                        const updatedGroups = groups.map((g: Group) => {
                          if (g.id === existingGroup.id) {
                            const diagnosesToAdd = currentSuggestion.diagnoses.filter(
                              (sd: Diagnosis) => !g.diagnoses.some((d: Diagnosis) => d.id === sd.id)
                            );
                            return { ...g, diagnoses: [...g.diagnoses, ...diagnosesToAdd] };
                          }
                          return g;
                        });
                        setGroups(updatedGroups);
                        debouncedUpload(updatedGroups);
                      } else {
                        const newGroup: Group = {
                          id: crypto.randomUUID(), name: trimmedName,
                          diagnoses: [...currentSuggestion.diagnoses],
                          subgroups: [], collapsed: false,
                        };
                        const updatedGroups = sortGroupsAlphabetically([...groups, newGroup]);
                        setGroups(updatedGroups);
                        debouncedUpload(updatedGroups);
                      }
                      const updatedSuggested = suggestedGroups.map((sg: Group, idx: number) =>
                        idx === currentSuggestedIndex ? { ...sg, diagnoses: [] } : sg
                      );
                      setSuggestedGroups(updatedSuggested);
                    }}
                    className={cn("bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm flex-1")}
                    disabled={!suggestedGroups[currentSuggestedIndex]?.diagnoses || suggestedGroups[currentSuggestedIndex].diagnoses.length === 0}
                  > Create / Merge Group </Button>
                </div>
                 <p className="text-xs text-gray-400 mt-2"> Or, drag them individually to your groups on the right. </p>
              </div>
              <div className="space-y-2">
                {(suggestedGroups[currentSuggestedIndex]?.diagnoses || []).map((d: Diagnosis) => (
                  <motion.div
                    key={d.id} draggable onDragStart={() => handleDragStart(d)}
                    className="bg-gray-700 rounded-md p-3 cursor-grab hover:bg-gray-600 transition-colors"
                    layoutId={`diagnosis-${d.id}-suggested`}
                  >
                    <h3 className="text-sm font-medium text-gray-200">{d.name}</h3>
                  </motion.div>
                ))}
              </div>
              {suggestedGroups[currentSuggestedIndex]?.diagnoses.length > 0 &&
                <p className="text-xs text-gray-400 mt-3">These items must be grouped before proceeding.</p>
              }
            </>
          ) : (
            <p className="text-gray-400 p-3">
                {/* MODIFIED: More specific loading message */}
                {loading && "Loading and processing suggestions..."} 
                {!loading && suggestedGroups.length === 0 && "No new suggestions available or an error occurred."}
                {!loading && suggestedGroups.length > 0 && currentSuggestedIndex >= suggestedGroups.length && "All suggestions have been processed. You can continue to create groups manually."}
            </p>
          )}
        </section>

        <section className="w-1/2 bg-gray-850 p-4 rounded-lg shadow-lg overflow-y-auto relative">
          <h2 className="text-xl font-semibold text-white mb-3 sticky top-0 bg-gray-850 py-2 z-10">Your Confirmed Groups</h2>
          <AnimatePresence>
            {groups.map((group: Group) => renderGroup(group, 0))}
          </AnimatePresence>
          <div className="mt-6 sticky bottom-0 bg-gray-850 py-3">
            {showAddGroupInput ? (
              <div className="flex flex-col sm:flex-row items-center gap-2 p-3 bg-gray-700 rounded-md">
                <Input type="text" placeholder="New Group Name" value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  className={cn("flex-grow bg-gray-600 border-gray-500 placeholder-gray-400")}
                />
                <div className="flex gap-2">
                    <Button onClick={() => {
                        const trimmedNewGroupName = newGroupName.trim();
                        if (!trimmedNewGroupName) return;
                        const groupNameExists = groups.some((g: Group) => g.name.toLowerCase() === trimmedNewGroupName.toLowerCase());
                        if (groupNameExists) {
                          alert("A group with this name already exists. Please choose a different name.");
                          return;
                        }
                        setUndoStack(prev => [...prev.slice(-9), groups]);
                        const newGroupToAdd: Group = { id: crypto.randomUUID(), name: trimmedNewGroupName, diagnoses: [], subgroups: [], collapsed: false };
                        const updatedGroups = sortGroupsAlphabetically([...groups, newGroupToAdd]);
                        setGroups(updatedGroups);
                        debouncedUpload(updatedGroups);
                        setNewGroupName(''); setShowAddGroupInput(false);
                    }} className={cn("bg-blue-600 hover:bg-blue-700")}> Add Group </Button>
                    <Button variant="ghost" onClick={() => {setShowAddGroupInput(false); setNewGroupName('');}} className={cn("hover:bg-gray-600")}> Cancel </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setShowAddGroupInput(true)} className={cn("w-full sm:w-auto bg-green-600 hover:bg-green-700")}>
                <Plus className="w-4 h-4 mr-2" /> Create New Group
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default DiagnosisGroupingApp;

