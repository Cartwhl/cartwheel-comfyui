"""Run in Blender's Text Editor; then File > Import > Saved camera (.json)."""
import json
import math
from pathlib import Path


def import_camera(filepath):
    import bpy
    from mathutils import Quaternion, Vector
    path=Path(filepath)
    if path.stat().st_size>20*1024*1024:raise ValueError('Camera JSON is too large.')
    doc=json.loads(path.read_text())
    if doc.get('units')!='meters' or doc.get('up')!='Y' or not doc.get('frames'):
        raise ValueError('Choose the edited_camera.json saved with this job.')
    if doc.get('lens_projection','perspective')!='perspective':
        raise ValueError('This helper imports perspective cameras. Fisheye poses/projection remain saved in JSON and can be reopened in the Comfy viewer.')
    fps=doc.get('fps',24)
    if not 1<=fps<=120 or len(doc['frames'])>14401:raise ValueError('Unsupported camera timeline.')
    # glTF import uses this same Y-up to Blender Z-up conversion.
    basis=Quaternion((1,0,0),math.pi/2)
    data=bpy.data.cameras.new('Saved edited camera');data.sensor_fit='VERTICAL';data.sensor_height=24
    camera=bpy.data.objects.new('Saved edited camera',data);bpy.context.collection.objects.link(camera)
    camera.rotation_mode='QUATERNION'
    for row in doc['frames']:
        values=[row['time'],row['fov'],*row['position'],*row['quaternion']]
        if not all(isinstance(v,(float,int)) and math.isfinite(v) for v in values):raise ValueError('Invalid camera sample.')
        frame=1+row['time']*fps
        camera.location=basis@Vector(row['position'])
        x,y,z,w=row['quaternion'];camera.rotation_quaternion=basis@Quaternion((w,x,y,z))
        data.lens=12/math.tan(math.radians(row['fov'])/2)
        camera.keyframe_insert(data_path='location',frame=frame);camera.keyframe_insert(data_path='rotation_quaternion',frame=frame);data.keyframe_insert(data_path='lens',frame=frame)
    cut_frames={1+row['time']*fps for row in doc['frames'] if row.get('cut')}
    for owner in [camera,data]:
        action=owner.animation_data.action if owner.animation_data else None
        if action:
            for curve in getattr(action,'fcurves',[]):
                points=list(curve.keyframe_points)
                for i,point in enumerate(points):
                    point.interpolation='CONSTANT' if i+1<len(points) and any(abs(points[i+1].co.x-f)<1e-5 for f in cut_frames) else 'LINEAR'
    scene=bpy.context.scene;scene.camera=camera;scene.render.fps=int(fps);scene.render.fps_base=1
    scene.render.resolution_y=doc.get('height',1080);scene.render.resolution_x=doc.get('width',round(scene.render.resolution_y*doc.get('aspect',16/9)))
    scene.render.resolution_percentage=100;scene.frame_start=1;scene.frame_end=max(1,math.ceil(doc['frames'][-1]['time']*fps));scene.frame_set(1)
    return camera


if __name__=='__main__':
    import bpy
    from bpy_extras.io_utils import ImportHelper
    from bpy.props import StringProperty
    class ImportSavedCamera(bpy.types.Operator,ImportHelper):
        bl_idname='import_scene.saved_comfy_camera';bl_label='Saved camera (.json)';filename_ext='.json'
        filter_glob:StringProperty(default='*.json',options={'HIDDEN'})
        def execute(self,context):
            try:import_camera(self.filepath)
            except (ValueError,KeyError,TypeError,OSError) as error:self.report({'ERROR'},str(error));return {'CANCELLED'}
            return {'FINISHED'}
    def menu(self,context):self.layout.operator(ImportSavedCamera.bl_idname,text='Saved camera (.json)')
    bpy.utils.register_class(ImportSavedCamera);bpy.types.TOPBAR_MT_file_import.append(menu)
    print('Use File > Import > Saved camera (.json), then select the edited camera file in the extracted job assets.')
