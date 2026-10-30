"""Discover independent character rigs and embedded cameras in uploaded scenes.

This is hierarchy/skin grouping, not semantic rig recognition or retargeting.
"""


def character_layout(nodes, meshes, parents, animated):
    """Return mesh/joint node sets per character and unassigned background meshes."""
    def ancestors(node):
        result=[];seen=set()
        while node in nodes:
            if len(seen)>128 or node in seen:raise ValueError('The uploaded scene contains a cyclic node hierarchy.')
            seen.add(node);result.append(node);node=parents.get(node)
        return result
    chains={node:ancestors(node) for node in nodes}
    def common(ids):
        ids=list(ids)
        if not ids:return None
        return next((n for n in chains[ids[0]] if all(n in chains[i] for i in ids[1:])),None)
    groups=[]
    for mesh,joints in meshes.items():
        if not joints:continue
        joints=set(joints)&nodes.keys()
        if not joints:continue
        matches=[g for g in groups if g['joints']&joints]
        group={'meshes':{mesh},'joints':joints}
        for match in matches:
            group['meshes']|=match['meshes'];group['joints']|=match['joints'];groups.remove(match)
        groups.append(group)
    # Meshes on separate skins sharing a rig root belong to the same character.
    for group in groups:group['root']=common(group['joints'])
    for group in groups[:]:
        if group not in groups:continue
        for other in groups[:]:
            if other is not group and group['root'] is not None and other['root'] is not None and (group['root'] in chains[other['root']] or other['root'] in chains[group['root']]):
                group['meshes']|=other['meshes'];group['joints']|=other['joints'];group['root']=common(group['joints']);groups.remove(other)
    assigned=set().union(*(g['meshes'] for g in groups)) if groups else set()
    rigid=set(meshes)-assigned
    # Attach rigid accessories parented within a known skeleton.
    for mesh in list(rigid):
        matches=[g for g in groups if any(j in chains[mesh] for j in g['joints'])]
        if len(matches)==1:matches[0]['meshes'].add(mesh);rigid.remove(mesh)
    # Independent animated branches without skins can be rigid characters.
    shared=common(meshes)
    branches={}
    for mesh in rigid:
        chain=chains[mesh]
        branch=chain[chain.index(shared)-1] if shared in chain and shared!=mesh else chain[-1]
        branches.setdefault(branch,set()).add(mesh)
    background=set()
    for branch,ids in branches.items():
        moving=any(branch in chains[a] for a in animated if a in chains)
        if moving:groups.append({'meshes':ids,'joints':set(),'root':branch})
        else:background|=ids
    if not groups:
        # Preserve a single character driven through unusual animation channels.
        groups=[{'meshes':set(meshes),'joints':set(),'root':common(meshes)}];background.clear()
    result=[]
    for group in groups:
        ids=group['meshes']|group['joints']
        # Include descendants of joints (e.g. unweighted fingers), while excluding
        # unrelated mesh/camera branches. Ancestors are retained by the viewer.
        ids|={n for n in nodes if any(j in chains[n] for j in group['joints']) and nodes[n].get('type') not in {'Mesh','Camera'}}
        root=group.get('root');name=nodes.get(root,{}).get('name') or nodes[next(iter(group['meshes']))].get('name','Actor')
        result.append({'nodes':sorted(ids),'name':name})
    result.sort(key=lambda g:min(g['nodes']))
    return result,sorted(background)


def fbx_layout(objects, connections):
    records={n[1][0]:n for n in objects if len(n[1])>=3 and n[0] in {'Model','Geometry','Deformer'}}
    models={i:{'name':n[1][1].split('\0')[0],'type':n[1][2]} for i,n in records.items() if n[0]=='Model'}
    oo=[c[1][1:3] for c in connections if c[0]=='C' and len(c[1])>=3 and c[1][0]=='OO']
    parent={child:p for child,p in oo if child in models and p in models}
    skins={i for i,n in records.items() if n[0]=='Deformer' and n[1][2]=='Skin'}
    clusters={i for i,n in records.items() if n[0]=='Deformer' and n[1][2]=='Cluster'}
    geometry={i for i,n in records.items() if n[0]=='Geometry' and n[1][2]=='Mesh'}
    meshes={i:set() for i,n in models.items() if n['type']=='Mesh' and any(c in geometry and p==i for c,p in oo)}
    from collections import defaultdict
    children=defaultdict(set);targets=defaultdict(set)
    for child,target in oo:children[target].add(child);targets[child].add(target)
    for skin in skins:
        bones=set().union(*(children[cluster] for cluster in children[skin]&clusters)) & models.keys()
        geos=targets[skin]&geometry
        for mesh in set().union(*(targets[geo] for geo in geos)) & meshes.keys():meshes[mesh]|=bones
    animated={c[1][2] for c in connections if c[0]=='C' and len(c[1])>=4 and c[1][0]=='OP' and c[1][2] in models}
    if not meshes:raise ValueError('The FBX contains no connected character mesh.')
    actors,background=character_layout(models,meshes,parent,animated)
    return {'actors':actors,'background_nodes':background}


def glb_layout(document):
    import math
    raw=document.get('nodes',[]);scenes=document.get('scenes',[]);index=document.get('scene',0)
    if not isinstance(index,int) or not 0<=index<len(scenes):raise ValueError('The GLB has no valid default scene.')
    reachable=set();parents={}
    def visit(i,chain):
        if len(chain)>128 or type(i) is not int or not 0<=i<len(raw) or i in chain:raise ValueError('The GLB scene hierarchy is invalid.')
        if i in reachable:raise ValueError('The GLB has a node with multiple parents.')
        reachable.add(i)
        for child in raw[i].get('children',[]):parents[child]=i;visit(child,chain|{i})
    for i in scenes[index].get('nodes',[]):visit(i,set())
    nodes={i:{'name':raw[i].get('name','Actor'),'type':'Mesh' if 'mesh' in raw[i] else 'Camera' if 'camera' in raw[i] else 'Node'} for i in reachable}
    skins=document.get('skins',[]);meshes={}
    for i in reachable:
        node=raw[i]
        if 'mesh' not in node:continue
        joints=set()
        if 'skin' in node:
            skin=node['skin']
            if type(skin) is not int or not 0<=skin<len(skins):raise ValueError('The GLB skin reference is invalid.')
            joints=set(skins[skin].get('joints',[]))
            if not joints<=reachable:raise ValueError('The GLB skeleton is outside its default scene.')
        meshes[i]=joints
    if not meshes:raise ValueError('The GLB scene contains no character mesh.')
    animated={channel.get('target',{}).get('node') for a in document.get('animations',[])[:1] for channel in a.get('channels',[])}
    actors,background=character_layout(nodes,meshes,parents,animated)
    cameras=[]
    for i in sorted(reachable):
        ref=raw[i].get('camera');all_cameras=document.get('cameras',[])
        if type(ref) is not int or not 0<=ref<len(all_cameras):continue
        cam=all_cameras[ref]
        if cam.get('type')!='perspective':continue
        p=cam.get('perspective',{});fov=p.get('yfov');aspect=p.get('aspectRatio',16/9);near=p.get('znear',.01);far=p.get('zfar',10000)
        if any(type(v) not in {int,float} or not math.isfinite(v) for v in [fov,aspect,near,far]) or not 0<fov<math.pi or aspect<=0 or near<=0 or far<=near:raise ValueError('The embedded GLB camera is invalid.')
        cameras.append({'node_id':i,'name':raw[i].get('name','Imported camera'),'aspect':aspect,'fov':math.degrees(fov),'near':near,'far':far,'projection':0})
    return {'actors':actors,'background_nodes':background,'cameras':cameras}
