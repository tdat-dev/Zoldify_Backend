import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { FollowsService } from './follows.service';
import { CreateFollowDto } from './dto/create-follow.dto';
import { UpdateFollowDto } from './dto/update-follow.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { User } from 'src/common/decorators/user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import type { IUser } from 'src/users/users.interface';

@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Follow thành công')
  @Post('toggle')
  toggle(@Body() dto: CreateFollowDto, @User() user: IUser) {
    return this.followsService.toggle(user.id, dto.following_id);
  }

  @Public()
  @Get(':userId/followers')
  getFollowers(@Param('userId') userId: string, @Query('page') page: string) {
    return this.followsService.getFollowers(+userId, page ? +page : 1);
  }

  @Public()
  @Get(':userId/following')
  getFollowing(@Param('userId') userId: string, @Query('page') page: string) {
    return this.followsService.getFollowing(+userId, page ? +page : 1);
  }

  @Public()
  @Get(':userId/count')
  async count(@Param('userId') userId: string) {
    const follower = await this.followsService.countFollowers(+userId);
    const following = await this.followsService.countFollowings(+userId);
    return {follower, following};
  }

  @UseGuards(JwtAuthGuard)
  @Get('check/:sellerId')
  async check(@Param('sellerId') sellerId: string, @User() user: IUser) {
    const followed = await this.followsService.isFollowing(user.id, +sellerId);
     return { followed };
  } 

}